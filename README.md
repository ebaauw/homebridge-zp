# homebridge-zp
[![npm](https://img.shields.io/npm/dt/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp) [![npm](https://img.shields.io/npm/v/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp)

## Homebridge plugin for Sonos ZonePlayer
(C) 2016-2017, Erik Baauw

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes [Sonos](http://www.sonos.com) ZonePlayers to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:
- Automatic discovery of Sonos zones, taking into account stereo pairs and home cinema setup;
- Control from HomeKit of play/pause per Sonos group;
- Control from HomeKit of volume, mute, bass, treble, and loudness per Sonos zone;
- Control from HomeKit of grouping Sonos zones into one Sonos group.  Support for multiple Sonos groups created with the Sonos app;
- Optional control from HomeKit of group volume and group mute per Sonos group.
- Real-time monitoring from Homekit of play/pause state, volume, mute, bass, treble, loudness, current track, group membership, and, optionally, group volume and group mute.  Like the Sonos app, homebridge-zp subscribes to ZonePlayer events to receive notifications.

## Zones
The homebridge-zp plugin creates an accessory per Sonos zone, named after the zone, e.g. "Living Room Sonos" for the "Living Room" zone.  Three services are created for each accessory:

1. "Living Room Sonos Group" for the group the zone is in.  This service provides play/pause control, (in future) input selection, and, optionally, group volume and group mute control.   It is tied to the Sonos AVTransport endpoint, and, optionally, to the GroupRenderingControl endpoint;

2. "Living Room Sonos Zone" for the zone itself.  This service provides control for volume, mute, bass, treble, and loudness.  It is tied to the Sonos RenderingControl endpoint;

3. The accessory information service.    

By default, homebridge-zp creates the Group and Zone services as `Switch`.  In addition to the standard `On` characteristic for play/pause control, the Group service contains additional characteristics for `Track`, `Zone Group`, and optionally `Volume` and `Mute`. The optional `Volume` and `Mute` are linked to the group volume and mute.

The Zone service's `On` characteristic is used to create, join, or leave a group with other zones.  The first zone, for which `On` is set, becomes the group coordinator; additional zones become members.  When `On` is cleared, the zone leaves the group.  Note that when the coordinator leaves the group, the music to the other zones is briefly interrupted, as the new coordinator assumes its role.  Furthermore, the Zone service contains characteristics for `Volume`, `Mute`, `Bass`, `Treble`, and `Loudness`.

Note that `Track`, `Zone Group`, `Bass`, `Treble`, and `Loudness` are custom characteristics.  They might not be supported by all HomeKit apps, see **Caveats** below.  

Note that neither Siri nor the iOS built-in [Home](http://www.apple.com/ios/home/) app support `Volume` nor `Mute`, even thought these are standard HomeKit characteristics.  Because of this, the type of service used for the Group and Zone, as well as the type of characteristic used for volume can be changed from config.json, see **Configuration** below and [issue #10](https://github.com/ebaauw/homebridge-zp/issues/10).

## Groups
When multiple Sonos zones (e.g. `Living Room` and `Kitchen`) are grouped into one Sonos group, the Sonos app shows them as a single room (e.g. `Living Room + 1`), with shared control for play/pause, input, and (group) volume and mute.  When this group is broken, the Sonos app shows two separate rooms, with separate control per room for play/pause, input, and (zone) volume and mute.  If we would mimic this behaviour in homebridge-zp, dynamically creating and deleting accessories for groups, HomeKit would lose the assignment to HomeKit rooms, scenes and triggers, every time an accessory is deleted.  Consequently, you would have to reconfigure HomeKit each time you group or ungroup Sonos zones.

To overcome this, homebridge-zp creates two services for each Sonos zone, one to control the Sonos group the zone is in, and one to control the zone itself.  When separated, the "Living Room Sonos Group" service controls the `Living Room` group, consisting of only the `Living Room` zone; and the "Kitchen Sonos Group" service controls the `Kitchen` group, consisting of only the `Kitchen` zone.  When grouped, both the "Living Room Sonos Group" service and the "Kitchen Sonos Group" service control the `Living Room + 1` group, containing both zones.  The `Zone Group` characteristic shows which group the zone belongs to, or rather: the zone that acts as controller for the group, in this example: "Living Room Sonos".  Of course, the Zone service always controls that zone.

## Installation
The homebridge-zp plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the Node.js JavaScript runtime `node`, from its [website](https://nodejs.org).  I'm using v6.9.2 LTS for macOS (x64), which includes the `npm` package manager.
- Make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there.
- You might want to update `npm` through `sudo npm update -g npm@latest`.  For me, this installs version 4.0.5.
- Install homebridge following the instructions on [GitHub](https://github.com/nfarina/homebridge).  For me, this installs homebridge version 0.4.16 to `/usr/local/lib/node_modules`.  Make sure to create a `config.json` in `~/.homebridge`, as described.
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
The following optional parameters can be added to modify homebridge-zp's behaviour:

- `host`: The hostname or IP address for the web server homebridge-zp creates to receive notifications from Sonos ZonePlayers.  This must be the hostname or IP address of the server running homebridge-zp, reachable by the ZonePlayers.  You might need to set this on a multi-homed server, if homebridge-zp binds to the wrong network interface.  Default: not specified, discover the server's IP address automatically;
- `port`: The port for the web server homebridge-zp creates to receive notifications from Sonos ZonePlayers.  Default: 0, use a random port.
- `searchTimeout`: The timeout in seconds to wait for a response when searching for Sonos Zoneplayers.  Default: 2 seconds;
- `subscriptionTimeout`: duration (in minutes) of the subscriptions homebridge-zp creates with each ZonePlayer.  Default: 30 minutes;
- `light`: Deprecated, use `service` and `brightness` instead;
- `service`: Defines what type of service and volume characteristic homebridge-zp uses.  Possible values are: `"switch"` for `Switch` and `Volume`; `"speaker"` for `Speaker` and `Volume`; `"light"` for `LightBulb` and `Brightness`; and `"fan"` for `Fan` and `Rotation Speed`.  Selecting `"light"` or `"fan"` enables changing the Sonos volume from Siri and from the iOS built-in [Home](http://www.apple.com/ios/home/) app.  Selecting `"speaker"` is not supported by the iOS built-in [Home](http://www.apple.com/ios/home/) app;
- `brightness`: Flag whether to expose volume as `Brightness` in combination with `Switch` or `Speaker`.  Default: `false`.  Setting this flag enables volume control from Siri;
- `zonegroups`: Deprecated.
- `groupvolume`: Flag whether to expose group volume and group mute per Group service, see **Groups** above.  Default: `false`.  You might want to change this if you have a multi-room Sonos configuration.

For reference, below is an example `config.json` that includes all parameters and their default values:
```
  "platforms": [
    {
      "platform": "ZP",
      "name": "ZP",
      "searchTimeout": 2,
      "subscriptionTimeout": 30,
      "service": "switch",
      "brightness": false,
      "groupvolume": false
    }
  ]
```

## Troubleshooting
If you run into issues, please run homebridge with only the homebridge-zp plugin enabled in `config.sys`.  This way, you can determine whether the issue is related to the homebridge-zp plugin itself, or to the interaction of multiple homebridge plugins in your setup.  Note that disabling the other plugins from your existing homebridge setup will remove their accessories from HomeKit.  You will need to re-assign these accessories to any HomeKit rooms, groups, scenes, and rules after re-enabling their plugins.  Alternatively, you can start a different instance of homebridge just for homebridge-zp, on a different system, or from a different directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.sys` for each instance.

The homebridge-zp plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-zp outputs a debug message for each request it makes to a Sonos ZonePlayer and for each ZonePlayer notification event it receives.  To capture these messages into a logfile, start homebridge as `homebridge -D > logfile 2>&1`.

The homebridge-zp plugin creates a web server to receive events from the Sonos ZonePlayers.  The IP address and port number for this listener are logged in a debug message, e.g.
> [ZP] listening on http://\<address\>:\<port\>/notify

To check whether the listener is reachable from the network, open this URL in your web browser.  You should get a reply like:
> homebridge-zp v0.1.4, node v6.9.2, homebridge v2.1

For each zone, the homebridge-zp plugin logs a debug message with the zone name and the type, ID and IP address and port of the corresponding ZonePlayer, e.g.
> Living Room: setup ZPS9 player RINCON_5CAAFDxxxxxx01400 at \<address\>:1400

To check whether the ZonePlayer has accepted the subscriptions to send notification events to homebridge-zp, open `http://<address>:1400/status` in your web browser to see the ZonePlayer diagnostics.  Select `upnp` and then select `Incoming subscriptions`.  Next to the subscriptions from other ZonePlayers and from Sonos apps, you should find the subscriptions from homebridge-zp.  Note that these subscriptions remain active after homebridge has exited (see [issue #5](https://github.com/ebaauw/homebridge-zp/issues/5)), until they timeout, (by default) 30 minutes after they were created or last renewed.

If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).  Please attach a copy of your full `config.json` (masking any sensitive info) and the debug logfile.

## Caveats
- The homebridge-zp plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).
- Homebridge is a great platform, but not really intented for consumers, as it requires command-line interaction.
- HomeKit is still relatively new, and the iOS built-in [Home](http://www.apple.com/ios/home/) app provides only limited support.  You might want to check some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) (paid), or, if you use `XCode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.
- The HomeKit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) provides access to multiple bridged accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a `Lightbulb`, `Switch`, `Motion Sensor`, ...).  There is also an accessory information service.  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed a an additional tool for `XCode`.
- The Sonos terminology needs some getting used to.  A _zone_ corresponds to a room.  It contains of a single ZonePlayer, two ZonePlayers configured as stereo pair, or a home cinema setup (with separate surround and/or sub speakers).  Typically, zone setup is static; you would only change it when re-arranging your rooms.  A _group_ is a collection of zones/rooms, playing the same music in sync.  A group is controlled by its _coordinator_.  Typically, groups are dynamic, you add and/or remove zones to/from a group when listening to your music.  Play/Pause control and input is per group.  Volume/Mute control is per group and per zone.
