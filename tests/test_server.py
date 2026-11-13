"""WebSocket signaling regression checks for independent RX/TX tuning.

Run from repository root with: python -m pytest tests/test_server.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from server import app, clients


def test_independent_frequency_and_ptt():
    with TestClient(app) as client:
        with client.websocket_connect('/ws') as a:
            a.send_json({'type': 'join', 'name': 'Radio A', 'channel': 1,
                         'frequency': '14,000.00', 'rx_frequency': 14000000,
                         'tx_frequency': 15000000, 'band': 'USB', 'mode': 'SSB'})
            assert a.receive_json()['type'] == 'welcome'
            first = a.receive_json()
            assert first['clients'][0]['rx_frequency'] == 14000000
            assert first['clients'][0]['tx_frequency'] == 15000000

            with client.websocket_connect('/ws') as b:
                b.send_json({'type': 'join', 'name': 'Radio B', 'channel': 1,
                             'frequency': '14,000.00', 'rx_frequency': 15000000,
                             'tx_frequency': 14000000, 'band': 'USB', 'mode': 'SSB'})
                assert b.receive_json()['type'] == 'welcome'
                state_a = a.receive_json()
                state_b = b.receive_json()
                assert len(state_a['clients']) == len(state_b['clients']) == 2

                a.send_json({'type': 'ptt', 'transmitting': True})
                assert a.receive_json()['type'] == 'ptt'
                assert b.receive_json()['type'] == 'ptt'

                b.send_json({'type': 'update-config', 'rx_frequency': None,
                             'tx_frequency': 14000000, 'frequency': '14,000.00',
                             'band': 'LSB', 'mode': 'AME'})
                assert a.receive_json()['type'] == 'state'
                updated = b.receive_json()
                radio_b = next(c for c in updated['clients'] if c['name'] == 'Radio B')
                assert radio_b['rx_frequency'] is None
                assert radio_b['tx_frequency'] == 14000000
                assert radio_b['band'] == 'LSB'
                assert radio_b['mode'] == 'AME'

    assert clients == {}
