# homebridge-zp
[![npm](https://img.shields.io/npm/dt/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp) [![npm](https://img.shields.io/npm/v/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp)

## Homebridge plugin for Sonos ZonePlayer
(C) 2016, Erik Baauw

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes [Sonos](http://www.sonos.com) ZonePlayers to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:
- Automatic discovery of Sonos ZonePlayers, taking into account stereo pairs and home cinema setup.
- ZonePlayer On/Off control from HomeKit, with automatic grouping.
- ZonePlayer volume and mute control from HomeKit.
- Monitoring ZonePlayer on/off state, volume, mute, and current track from HomeKit.  Like the Sonos app, homebridge-zp subscribes to ZonePlayer events to receive notifications.

## Zones
The homebridge-zp plugin creates a `Switch` accessory per zone (room), named after the zone, e.g. "Living Room Sonos" for the "Living Room" zone.  In addition to the standard `On` characteristic, additional characterisics for `Volume`, `Mute`, and `Track` are provided.  Note that `Track` is a custom characteristic, which might not be supported by all HomeKit apps.  Also note that the iOS 10 [Home](http://www.apple.com/ios/home/) app does not support `Volume` and `Mute`, even thought these are standard HomeKit characteristics.

## Automatic Grouping
With just one zone, the `On` characteristic works as Play/Pause button.  With multiple zones, the `On` characteristic also provides automatic grouping.  When `On` is set to `true`, homebridge-zp checks whether another zone is already playing.  If so, the zone joins the group of the other zone, otherwise the zone starts playing.  When `On` is set to `false`, homebridge-zp checks whether the zone is member of a group.  If so, the zone leaves the group, otherwise the zone stops playing.  Note that when the coordinator leaves the group, the music to the other zones is briefly interrupted, as the new coordinator assumes its role.

## Installation
The homebridge-zp plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the Node.js JavaScript runtime `node`, from its [website](https://nodejs.org).  I'm using v6.9.2 LTS for macOS (x64), which includes the `npm` package manager.
- Make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there.
- You might want to update `npm` through `sudo npm update -g npm@latest`.  For me, this installs version 4.0.3.
- Install homebridge following the instructions on [GitHub](https://github.com/nfarina/homebridge).  For me, this installs homebridge version 0.4.11 to `/usr/local/lib/node_modules`.  Make sure to create a `config.json` in `~/.homebridge`, as described.
- Install the homebridge-zp plugin through `sudo npm install -g homebridge-zp`.
- Edit `~/.homebridge/config.json` and add the `ZP` platform provided by homebridge-zp, see below.

Once homebridge is up and running with the homebridge-zp plugin, you might want to daemonise it and start it automatically on login or system boot.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for more info how to do that on MacOS or on a Raspberri Pi.

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

## Troubleshooting
If you run into issues, please run homebridge with only the homebridge-zp plugin enabled in `config.sys`.  This way, you can determine whether the issue is related to the homebridge-zp plugin itself, or to the interaction of multiple homebridge plugins in your setup.  Note that disabling the other plugins from your existing homebridge setup will remove their accessories from HomeKit.  You will need to re-assign these accessories to any HomeKit rooms, groups, scenes, and rules after re-enabling their plugins.  Alternatively, you can start a different instance of homebridge just for homebridge-zp, on a different system, or from a different directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.sys` for each instance.

The homebridge-zp plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-zp outputs a debug message for each request it makes to a Sonos ZonePlayer and for each ZonePlayer notification event it receives.  To capture these messages into a logfile, start homebridge as `homebridge -D > logfile 2>&1`.

The homebridge-zp plugin creates a web server to receive events from the Sonos ZonePlayers.  The IP address and port number for this listener are logged in a debug message, e.g.
> [ZP] listening on http://\<address\>:\<port\>/notify

To check whether the listener is reachable from the network, open this URL in your web browser.  You should get a reply like:
> homebridge-zp v0.0.4, node v4.6.1, homebridge v2.1

For each zone, the homebridge-zp plugin logs a debug message with the zone name and the type, ID and IP address and port of the corresponding ZonePlayer, e.g.
> Living Room: setup ZPS9 player RINCON_5CAAFDxxxxxx01400 at \<address\>:1400

To check whether the ZonePlayer has accepted the subscriptions to send notification events to homebridge-zp, open `http://<address>:1400/status` in your web browser to see the ZonePlayer diagnostics.  Select `upnp` and then select `Incoming subscriptions`.  Next to the subscriptions from other ZonePlayers and from Sonos apps, you should find the subscriptions from homebridge-zp.  Note that these subscriptions remain active after homebridge has exited (see issue #5), until they timeout, 30 minutes after they were created or last renewed.

If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).  Please attach a copy of your full `config.json` (masking any sensitive info) and the debug logfile.

## Caveats
- The homebridge-zp plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).
- Homebridge is a great platform, but not really intented for consumers, as it requires command-line interaction.
- HomeKit is still relatively new, and the iOS 10 built-in [Home](http://www.apple.com/ios/home/) app provides only limited support.  You might want to check some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) (paid), or, if you use `XCode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.
- The HomeKit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) provides access to multiple bridged accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a `Lightbulb`, `Switch`, `Motion Sensor`, ...).  There is also an accessory information service.  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed a an additional tool for `XCode`.
- The Sonos terminology needs some getting used to.  A _zone_ corresponds to a room.  It contains of a single ZonePlayer, two ZonePlayers configured as stereo pair, or a home cinema setup (with separate surround and/or sub speakers).  Typically, zone setup is static; you would only change it when re-arranging your rooms.  A _group_ is a collection of zones/rooms, playing the same music in sync.  A group is controlled by its _coordinator_.  Typically, groups are dynamic, you add and/or remove zones to/from a group when listening to your music.  Play/Pause control is per group.  Volume/Mute control is per zone (and per group, but homebridge-zp currently doesn't support that, see issue #4).
