# MICOM-3T Internet Radio Trainer — R8 development

A browser-based MICOM-3T training simulator: realistic radio control panel, local FastAPI/WebSocket signaling server, WebRTC voice, and manual-based radio behavior.

**Branches:** `main` preserves the R7 baseline. `manual-phase1` is the experimental R8 build, implementing the first manual-guided corrections. The original R7 local install is not changed by repository commits.

## Run on Windows

```powershell
python -m pip install -r requirements.txt
python server.py
```

Open http://localhost:8000.

For access from another computer, in a **separate** Command Prompt:

```powershell
ngrok http 8000
```

Share the public HTTPS forwarding address. Leave the Python server and ngrok running. Updating GitHub does **not** automatically change files on the local computer: download or pull the selected branch and restart the server.

## New in R8

- Menu → FREQ → SMPX / DPLX / RXO / TXO, with direct numeric keypad entry, `*` for decimal and ENTER to confirm. For duplex, enter RX first, then TX.
- RX frequency: 100 kHz–30 MHz; TX frequency: 1.6–30 MHz, 10 Hz resolution.
- Two radios can communicate when sender TX matches listener RX, sideband and operating mode match, and the receiving simulator's MON is enabled. SQ controls idle noise. Channel numbers do not decide who can hear whom.
- Manual's 200-channel capacity. Only four preprogrammed demonstration channels exist; unprogrammed channels show `NOT PROG` rather than fictitious frequencies.
- More robust early WebRTC ICE candidate handling and independent frequency signaling to support duplex and RX-only/TX-only.
- No changes to the carefully placed radio art, hotspot coordinates, or individually positioned LCD status indicators.

## Tests

Install development test dependencies (optional):

```powershell
python -m pip install -r requirements-dev.txt
```

Then run:

```powershell
node --check static/app.js
node tests/radio_core.test.cjs
node tests/ui_smoke.test.cjs
python -m pytest tests/test_server.py
```

See [manual implementation audit](docs/manual-audit.md) for documented behavior, remaining menu functions, and fidelity limitations.

## Limitations

The application is **not** a real RF transceiver. Many functions (ALE, SCAN, stored-channel programming, VFO A/B, CLAR, NF, BIT, advanced options) are not implemented yet. The existing training choice that MON must be on is preserved, although the physical radio's manual describes MON within ALE operations.

WebRTC uses public STUN; ngrok exposes the website and WebSocket signaling, **not** the media relay. Some connections will require a TURN server. Multi-network voice has not yet been fully validated on R8.
