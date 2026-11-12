
from __future__ import annotations

import json
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / 'static'

app = FastAPI(title='Radio Trainer Prototype')
app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')

clients: dict[str, dict[str, Any]] = {}
channels: dict[int, set[str]] = defaultdict(set)


def public_state() -> dict[str, Any]:
    return {
        'type': 'state',
        'clients': [
            {
                'id': cid,
                'name': info['name'],
                'channel': info['channel'],
                'frequency': info.get('frequency', ''),
                'band': info.get('band', 'USB'),
                'mode': info.get('mode', 'SSB'),
            }
            for cid, info in clients.items()
        ],
        'channels': {
            str(channel): [
                {'id': cid, 'name': clients[cid]['name']}
                for cid in member_ids
                if cid in clients
            ]
            for channel, member_ids in channels.items()
        },
    }


async def broadcast(message: dict[str, Any]) -> None:
    dead: list[str] = []
    for cid, info in clients.items():
        try:
            await info['ws'].send_text(json.dumps(message))
        except Exception:
            dead.append(cid)
    for cid in dead:
        await disconnect_client(cid)


async def send_to(client_id: str, message: dict[str, Any]) -> None:
    info = clients.get(client_id)
    if not info:
        return
    await info['ws'].send_text(json.dumps(message))


async def disconnect_client(client_id: str) -> None:
    info = clients.pop(client_id, None)
    if not info:
        return
    channel = info['channel']
    channels[channel].discard(client_id)
    if not channels[channel]:
        channels.pop(channel, None)
    await broadcast({'type': 'peer-left', 'peer_id': client_id, 'channel': channel})
    await broadcast(public_state())


@app.get('/')
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / 'index.html')


@app.websocket('/ws')
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    client_id = str(uuid.uuid4())
    try:
        join_raw = await ws.receive_text()
        join_msg = json.loads(join_raw)
        if join_msg.get('type') != 'join':
            await ws.close(code=1008)
            return

        name = str(join_msg.get('name') or f'Radio-{client_id[:4]}').strip()[:24]
        channel = int(join_msg.get('channel', 1))
        frequency = str(join_msg.get('frequency', '')).strip()[:32]
        band = str(join_msg.get('band', 'USB')).strip()[:8] or 'USB'
        mode = str(join_msg.get('mode', 'SSB')).strip()[:8] or 'SSB'
        if channel < 1 or channel > 500:
            channel = 1

        clients[client_id] = {
            'ws': ws,
            'name': name,
            'channel': channel,
            'frequency': frequency,
            'band': band,
            'mode': mode,
        }
        channels[channel].add(client_id)

        await send_to(client_id, {'type': 'welcome', 'your_id': client_id})
        await broadcast(public_state())

        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get('type')

            if msg_type == 'switch-channel':
                new_channel = int(data.get('channel', 1))
                if new_channel < 1 or new_channel > 500:
                    continue
                new_frequency = str(data.get('frequency', '')).strip()[:32]
                old_channel = clients[client_id]['channel']
                if old_channel == new_channel:
                    continue
                channels[old_channel].discard(client_id)
                if not channels[old_channel]:
                    channels.pop(old_channel, None)
                channels[new_channel].add(client_id)
                clients[client_id]['channel'] = new_channel
                clients[client_id]['frequency'] = new_frequency
                await broadcast({'type': 'peer-left', 'peer_id': client_id, 'channel': old_channel})
                await broadcast(public_state())

            elif msg_type == 'update-config':
                clients[client_id]['frequency'] = str(data.get('frequency', clients[client_id].get('frequency', '')))[:32]
                clients[client_id]['band'] = str(data.get('band', clients[client_id].get('band', 'USB')))[:8]
                clients[client_id]['mode'] = str(data.get('mode', clients[client_id].get('mode', 'SSB')))[:8]
                await broadcast(public_state())

            elif msg_type == 'signal':
                target_id = data.get('target')
                payload = data.get('payload')
                if not target_id or target_id not in clients:
                    continue
                await send_to(target_id, {'type': 'signal', 'from': client_id, 'payload': payload})

            elif msg_type == 'ptt':
                transmitting = bool(data.get('transmitting', False))
                channel = clients[client_id]['channel']
                await broadcast({
                    'type': 'ptt',
                    'peer_id': client_id,
                    'channel': channel,
                    'transmitting': transmitting,
                })

    except WebSocketDisconnect:
        pass
    finally:
        await disconnect_client(client_id)


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('server:app', host='0.0.0.0', port=8000, reload=False)
