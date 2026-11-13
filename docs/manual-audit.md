# MICOM-3F/3T/3R Owner's Guide implementation audit

Reference: Motorola, *MICOM-3F/3T/3R HF-SSB Transceivers — Owner's Guide, Part I: Operation & Installation*, 6886867J01A (2005), supplied by the project owner.

**Important:** This is a training simulation, not a real HF transceiver or a validated RF propagation model. The manual itself is not included in this public repository. The interface image/button hotspot positions remain as supplied by the project owner.

## Manual requirements and current coverage (R8)

| Manual | Reference in printed manual | R8 status |
|---|---:|---|
| MICOM-3T front panel, MENU/ESC/ENTER and four soft keys | pp. 5, 10–15 | Existing clickable interface retained; some shortcuts/menus still placeholders |
| 200 user-programmable channels | Specifications p. iv; pp. 18–22 | Capacity capped at 200; four demonstration channels are populated; other channels show NOT PROG |
| Main channel selection and last active channel | pp. 18–22 | Channel selector and navigation implemented; not all persistent options implemented |
| Frequency types SMPX, DPLX, RXO, TXO | pp. 22–25 | **R8:** selection and separate RX/TX tuning implemented |
| Receive range 100 kHz–30 MHz; transmit range 1.6–30 MHz | p. 23 | **R8:** enforced with 10 Hz resolution |
| Keypad direct frequency entry, decimal point, ENTER | pp. 23–25 | **R8:** implemented; cursor-based frequency digit scrolling not yet implemented |
| Duplex first confirms RX then TX | pp. 24–25 | **R8:** implemented |
| A/B VFO operation | pp. 25–26 | Not yet implemented |
| Frequency STOR into a programmed channel | pp. 29 and 82 | Not yet implemented; no user-facing persistent channel programmer |
| BAND, SQ, DSP, PWR, MODE, AGC, BW | pp. 19–20, 27–29 | Existing controls; not all selection flows fully mirror manual |
| CLAR, NF, ATTN and RCLV | pp. 19–20, 27–29 | Not yet implemented / placeholders |
| Scan groups | pp. 30–31 | Not yet implemented |
| ALE calling, scan, link procedures and messages | pp. 34–77 | Not yet implemented |
| Programming menus and ALE programming | pp. 78–94 | Not yet implemented |
| Privacy, vocoder and GPS optional accessories | pp. 95–109 | Not yet implemented; option-dependent simulation only |
| BIT and fault testing | pp. 31, 124–129 | Not yet implemented |

## Radio communication model (R8)

Every connected browser advertises **rx_frequency**, **tx_frequency**, **band**, and **mode**. These frequencies are stored as integer Hertz at 10 Hz resolution.

- Local radio can hear a remote radio when the **local RX equals remote TX**, and their USB/LSB band and SSB/AME/PLT mode match.
- A radio may be tuned TX-only (no receiver) or RX-only (PTT blocked). Duplex stations may transmit and receive on different frequencies.
- Browser WebRTC voice is negotiated when either direction of a pair is potentially receivable. Channel numbers do not determine voice eligibility.
- The simulator currently requires **MON ON** to hear voice, per the existing project training requirement. The owner's guide describes MON in the ALE context, so this is a *deliberate deviation* to review when ALE is implemented.
- SQ ON mutes idle audio based on the remote PTT state. The real radio uses digital speech detection; proper simulated voice detection is a future improvement.
- STUN is configured. Reliable media behind restrictive networks still needs a configured TURN server. Ngrok only exposes the HTTP/WebSocket signaling service.

## Next implementation increments

1. Complete frequency cursor editing and VFO A/B, including display transition tests.
2. Add program/recall/store channel records and per-channel option defaults.
3. Complete DSP, bandwidth, RF level display, program/lock/BIT and relevant menu flows.
4. Implement scan groups and simulated ALE calls and network behavior.
5. Add local persistence and multi-browser/end-to-end audio tests with TURN when available.

## Verification

Run from repo root:

```sh
node --check static/radio_core.js
node --check static/app.js
node tests/radio_core.test.cjs
node tests/ui_smoke.test.cjs
python -m pytest tests/test_server.py
```

The WebSocket regression test verifies signaling metadata, not real microphone transmission. Before merging, perform a two-browser audio test; for a full internet test, use separate physical networks.
