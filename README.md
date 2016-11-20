# homebridge-zp
(C) 2016, Erik Baauw

Homebridge plug-in for Sonos ZonePlayer

This plug-in exposes Sonos ZonePlayers to Apple's Homekit.  It provides the following features:
- Automatic discovery of Sonos ZonePlayers, taking into account stereo pairs and home cinema setup;
- ZonePlayer On/Off control from Homekit, with automatic grouping.
- ZonePlayer volume and mute control from Homekit.
- Monitoring ZonePlayer on/off state, volume, mute, and current track from Homekit.  Like the Sonos app, homebridge-zp subscribes to ZonePlayer events to receive notifications.

## Configuration
In homebridge's `config.json` you need to specify a platform for homebridge-zp;
```
  "platforms": [
    {
      "platform": "ZP",
      "name": "ZP"
    }
  ]
```

## Caveats
- The homebridge-zp plug-in is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on GitHub.
- Homebridge is a great platform, but not really intented for consumers.
- Homekit is still relatively new, and the iOS 10 built-in `Home` app provides only limited support.  You might want to check some other homekit apps, like Elgato's `Eve` (free), Matthias Hochgatterer's `Home`, or, if you use `XCode`, Apple's `HMCatalog` example app.
