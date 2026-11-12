# MICOM-3T Internet Radio Trainer

Browser-based MICOM-3T radio interface with a local Python FastAPI signaling server and WebRTC microphone audio.

## Run on Windows

```powershell
python -m pip install -r requirements.txt
python server.py
```

Open http://localhost:8000.

For remote access, in a separate command prompt run:

```powershell
ngrok http 8000
```

Share the HTTPS forwarding address with participants. The Windows PC and both commands must remain running.

## Radio communication

Receivers should hear transmissions only when their radio matches the sender's frequency, USB/LSB band, and SSB/AME/PLT mode, and MON is enabled. SQ controls simulated static; it should not block voice. The channel number is not an audio matching criterion.

## Notes

This is the R7 development baseline. The previous ZIP is `radio_trainer_micom3t_comm_logic_r7.zip`. The application code and original image assets must be uploaded for the repository to be runnable. WebRTC with STUN alone may fail across NAT; TURN will be needed for some users.

This repository is for source control; the actual trainer is hosted on your computer through Python and ngrok.
