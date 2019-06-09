# homebridge-zp
[![npm](https://img.shields.io/npm/dt/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp) [![npm](https://img.shields.io/npm/v/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Homebridge plugin for Sonos ZonePlayer
Copyright © 2016-2019 Erik Baauw. All rights reserved.

This [homebridge](https://github.com/nfarina/homebridge) plugin exposes [Sonos](http://www.sonos.com) ZonePlayers to Apple's [HomeKit](http://www.apple.com/ios/home/).  It provides the following features:
- Automatic discovery of Sonos zones, taking into account stereo pairs and home theatre setup;
- Support for Sonos groups, created through the Sonos app;
- Control from HomeKit of play/pause, volume, and mute per Sonos group;
- Optional control from HomeKit of volume, mute, bass, treble, and loudness per Sonos zone;
- Optional control from HomeKit for Sonos zones leaving Sonos groups, and for Sonos zones creating/joining one Sonos group;
- Real-time monitoring from HomeKit of play/pause state, volume, mute, current track, and coordinator per Sonos Group; and, optionally, of volume, mute, bass, treble, loudness per Sonos zone.  Like the Sonos app, homebridge-zp subscribes to ZonePlayer events to receive notifications;
- Optional control from HomeKit for the status LED.  Note that Sonos doesn't support events for the status LED, so homebridge-zp cannot provide real-time monitoring for this;

### Prerequisites
You need a server to run homebridge.  This can be anything running [Node.js](https://nodejs.org): from a Raspberri Pi, a NAS system, or an always-on PC running Linux, macOS, or Windows.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for details.  I use a Mac mini server, and, occasionally, a Raspberri Pi 3 model B.

To interact with HomeKit, you need Siri or a HomeKit app on an iPhone, Apple Watch, iPad, iPod Touch, or Apple TV (4th generation or later).  I recommend to use the latest released versions of iOS, watchOS, and tvOS.
Please note that Siri and even Apple's [Home](https://support.apple.com/en-us/HT204893) app still provide only limited HomeKit support.  To use the full features of homebridge-zp, you might want to check out some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) app (free) or Matthias Hochgatterer's [Home](http://selfcoded.com/home/) app (paid).
For HomeKit automation, you need to setup an Apple TV (4th generation or later) or iPad as [Home Hub](https://support.apple.com/en-us/HT207057).

### Zones
The homebridge-zp plugin creates an accessory per Sonos zone, named after the zone, e.g. *Living Room Sonos* for the *Living Room* zone.  By default, this accessory contains a single `Switch` service, with the same name as the accessory.  In addition to the standard `Power State` characteristic for play/pause control, additional characteristics are provided for `Volume`, `Mute`, `Current Track` (read-only) and `Sonos Group` (read-only). Note that `Current Track` and `Sonos Group` are custom characteristics.  They might not be supported by all HomeKit apps, see [**Caveats**](#caveats).

Note that neither Siri nor the Apple's Home app support `Volume` or `Mute`, even thought these are standard HomeKit characteristics.  Because of this, the type of the service, as well as the type of characteristic used for volume can be changed from `config.json`, see [**Configuration**](#configuration) and [issue #10](https://github.com/ebaauw/homebridge-zp/issues/10).

### Groups
When multiple Sonos zones, e.g. *Living Room* and *Kitchen*, are grouped into one Sonos group, the Sonos app shows them as a single room, e.g. *Living Room + 1*, with shared control for play/pause, music source, and (group) volume and mute.  When this group is broken, each zone forms a separate standalone group, containing only that zone.  The Sonos app shows each standalone group as a separate room, with separate control per room for play/pause, music source, and (zone) volume and mute.

If we would mimic this behaviour in homebridge-zp, dynamically creating and deleting accessories for groups, HomeKit would lose the assignment to HomeKit rooms, scenes and triggers, every time an accessory is deleted.  Consequently, you would have to reconfigure HomeKit each time you group or ungroup Sonos zones.

To overcome this, homebridge-zp creates an accessory and corresponding service for each Sonos zone.  This service actually controls the Sonos *group* the zone is in rather than the zone.  When separated, the *Living Room Sonos* service controls the standalone *Living Room* group, consisting of only the *Living Room* zone; and the *Kitchen Sonos* service controls the standalone *Kitchen* group, consisting of only the *Kitchen* zone.  When grouped, both the *Living Room Sonos* service and the *Kitchen Sonos* service control the multi-zone *Living Room + 1* group, containing both the *Living Room* and *Kitchen* zones.  The `Sonos Group` characteristic shows which group the zone belongs to, or rather: the name of the group coordinator zone, in this example: *Living Room*.

So when grouped, changing the *Living Room Sonos* `Volume` changes the volume of both the *Living Room* zone and the *Kitchen* zone.  So does changing the *Kitchen Sonos* `Volume`.  When ungrouped, changing the *Living Room Sonos* `Volume` only changes the volume of the *Living Room* zone; and changing the *Kitchen Sonos* `Volume` only changes the volume of the *Kitchen* zone.

### Speakers
Changing in HomeKit the volume of an individual zones in a multi-zone group requires an additional `Volume` characteristic for the zone, next to the `Volume` characteristic for the group.  As HomeKit doesn't support multiple characteristics of the same type per service, it actually requires an additional service.  By specifying `"speakers": true` in `config.json`, homebridge-zp creates an additional *Speakers* service for each zone accessory, to control the individual zone.  This service is named after the zone as well, in our example: *Living Room Speakers*.

Like the *Sonos* service, the type of the *Speakers* service can be changed in `config.json` from the default `Switch`.  The *Speakers* service `Power On` characteristic is used to create, join, or leave a Sonos group.  Additional characteristics for `Volume`, `Mute`, `Bass`, `Treble`, and `Loudness` control the corresponding zone attributes.
Note that `Bass`, `Treble`, and `Loudness` are custom characteristics.  They might not be supported by all HomeKit apps, see **Caveats** below.

When grouping zones from the Sonos app, homebridge-zp sets the *Speakers* `On` characteristic for a zone in a multi-zone group and clears it for a zone in a standalone group.  When setting the *Speakers* `On` from HomeKit, that zone will join the (first) existing multi-zone Sonos group.  When no multi-zone Sonos group yet exists, the zone is designated as coordinator for a future multi-zone group.  When `On` is cleared from HomeKit, the zone leaves its current group, forming a standalone group.  Note that when the coordinator leaves the group, the music to the other zones in that group is briefly interrupted, as the new coordinator assumes its role.

### Command-Line Tool
The `homebridge-zp` plugin comes with a command-line tool, `zpinfo`, for retrieving information from a Sonos ZonePlayer.  It takes a `-h` or `--help` argument to provide a brief overview of its functionality and command-line arguments.

### Installation
The homebridge-zp plugin obviously needs homebridge, which, in turn needs Node.js.  I've followed these steps to set it up on my macOS server:

- Install the latest v10 LTS version of Node.js.  On a Raspberry Pi, use the 10.x [Debian package](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions). On other platforms, download the [10.x.x LTS](https://nodejs.org) installer.  Both installations include the `npm` package manager;
- On macOS, make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there.  On a Raspberry Pi, these install to `/usr/bin`;
- You might want to update `npm` through `sudo npm -g update npm@latest`;
- Install homebridge through `sudo npm -g install homebridge`.  Follow the instructions on [GitHub](https://github.com/nfarina/homebridge#installation) to create a `config.json` in `~/.homebridge`, as described;
- Install the homebridge-zp plugin through `sudo npm -g install homebridge-zp`;
- Edit `~/.homebridge/config.json` and add the `ZP` platform provided by homebridge-zp, see [**Configuration**](#configuration).

Once homebridge is up and running with the homebridge-zp plugin, you might want to daemonise it and start it automatically on login or system boot.  See the [homebridge Wiki](https://github.com/nfarina/homebridge/wiki) for more info how to do that on MacOS or on a Raspberri Pi.

### Configuration
In homebridge's `config.json` you need to specify a platform for homebridge-zp:
```json
  "platforms": [
    {
      "platform": "ZP"
    }
  ]
```
The following optional parameters can be added to modify homebridge-zp's behaviour:

Key | Default | Description
--- | ------- | -----------
`alarms` | `false` | Flag whether to expose an additional service per Sonos alarm.
`brightness` | `false` | Flag whether to expose volume as `Brightness` when `service` is `"switch"` or `"speaker"`.  Setting this flag enables volume control from Siri, but not from Apple's Home app.
`leds` | `false` | Flag whether to expose an additional *Lightbulb* service per zone for the status LED.
`host` | _(discovered)_ | The hostname or IP address for the web server homebridge-zp creates to receive notifications from Sonos ZonePlayers.  This must be the hostname or IP address of the server running homebridge-zp, reachable by the ZonePlayers.  You might need to set this on a multi-homed server, if homebridge-zp binds to the wrong network interface.
`port` | `0` _(random)_ | The port for the web server homebridge-zp creates to receive notifications from Sonos ZonePlayers.
`searchTimeout` | `15` | The timeout (in seconds) to wait for a response when searching for Sonos Zoneplayers.
`service` | `"switch"` | Defines what type of service and volume characteristic homebridge-zp uses.  Possible values are: `"switch"` for `Switch` and `Volume`; `"speaker"` for `Speaker` and `Volume`; `"light"` for `LightBulb` and `Brightness`; and `"fan"` for `Fan` and `Rotation Speed`.  Selecting `"light"` or `"fan"` enables changing the Sonos volume from Siri and from Apple's Home app.  Selecting `"speaker"` is not supported by Apple's Home app.
`speakers` | `false` | Flag whether to expose a second *Speakers* service per zone, in addition to the standard *Sonos* service, see [**Speakers**](#speakers).  You might want to set this if you're using Sonos groups in a configuration of multiple Sonos zones.
`subscriptionTimeout` | `30` | The duration (in minutes) of the subscriptions homebridge-zp creates with each ZonePlayer.
`nameScheme` | `"% Sonos"` | The name scheme for the HomeKit accessories.  `%` is replaced with the player name.  E.g. with the default name scheme, the accessory for the `Kitchen` zone is set to `Kitchen Sonos`.  Note that this does _not_ change the names of the HomeKit services, used by Siri.

Below is an example `config.json` that exposes the *Sonos* and *Speakers* service as a HomeKit `Speaker` and volume as `Brightness`, so it can be controlled from Siri:
```json
  "platforms": [
    {
      "platform": "ZP",
      "service": "speaker",
      "brightness": true,
      "speakers": true
    }
  ]
```

### Troubleshooting
If you run into issues, please run homebridge with only the homebridge-zp plugin enabled in `config.json`.  This way, you can determine whether the issue is related to the homebridge-zp plugin itself, or to the interaction of multiple homebridge plugins in your setup.  Note that disabling the other plugins from your existing homebridge setup will remove their accessories from HomeKit.  You will need to re-assign these accessories to any HomeKit rooms, groups, scenes, and rules after re-enabling their plugins.  Alternatively, you can start a different instance of homebridge just for homebridge-zp, on a different system, or from a different directory (specified by the `-U` flag).  Make sure to use a different homebridge `name`, `username`, and (if running on the same system) `port` in the `config.json` for each instance.

The homebridge-zp plugin outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-zp outputs a debug message for each request it makes to a Sonos ZonePlayer and for each ZonePlayer notification event it receives.  To capture these messages into a logfile, start homebridge as `homebridge -D > logfile 2>&1`.

For each zone found, the homebridge-zp plugin logs a debug message with the zone name and the type, ID and IP address and port of the corresponding ZonePlayer, e.g.
```
[2018-9-28 12:35:47] [ZP] Living Room: setup ZPS9 v9.1 player RINCON_5CAAFDxxxxxx01400 at 192.168.76.71:1400
```

Like the Sonos app, homebridge-zp subscribes to the ZonePlayer events to be notified in real-time of changes.  It creates a web server to receive these notifications.  The IP address and port number for this listener are logged in a debug message, e.g.
```
[2018-9-28 12:36:02] [ZP] listening on http://192.168.xxx.xxx:xxxxx/notify
```
To check whether the listener is reachable from the network, open this URL in your web browser.  You should get a reply like:
```
homebridge-zp v0.3.16, node v10.15.3, homebridge v0.4.49
```

If you need help, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).  Please attach a copy of your full `config.json` (masking any sensitive info) and the debug logfile.
For questions, you can also post a message to the **#homebridge-zp** channel of the [homebridge workspace on Slack](https://github.com/nfarina/homebridge#community).

### Caveats
The homebridge-zp plugin is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for years, but your mileage might vary.  Please report any issues on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).

Homebridge is a great platform, but not really intended for consumers, as it requires command-line interaction.

HomeKit is still relatively new, and Apple's [Home](https://support.apple.com/en-us/HT204893) app provides only limited support.  You might want to check out some other HomeKit apps, like Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) (free), Matthias Hochgatterer's [Home](http://selfcoded.com/home/) (paid), or, if you use `Xcode`, Apple's [HMCatalog](https://developer.apple.com/library/content/samplecode/HomeKitCatalog/Introduction/Intro.html#//apple_ref/doc/uid/TP40015048-Intro-DontLinkElementID_2) example app.

The HomeKit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) provides access to multiple bridged accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a lightbulb, switch, motion sensor, ...).  There is also an accessory information service.  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by HomeKit apps.  You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/library/content/documentation/NetworkingInternet/Conceptual/HomeKitDeveloperGuide/TestingYourHomeKitApp/TestingYourHomeKitApp.html), which is distributed as an additional tool for `Xcode`.

The Sonos terminology needs some getting used to.  A _zone_ corresponds to a physical room.  It consists of a single ZonePlayer, two ZonePlayers configured as a stereo pair, or a home theatre setup (e.g. a PlayBar with separate surround speakers).  Typically, zone setup is static; you would only change it when physically re-arranging your ZonePlayers between rooms.  A _group_ is a collection of one or more zones, playing the same music in sync.  A group is controlled by its _coordinator_ zone.  Typically, groups are dynamic, you add and/or remove zones to/from a group when listening to your music.  Controls for play/pause and music source act on a group.  Controls for volume and mute act on a group or on a zone.  Controls for bass, treble, and loudness act on a zone.  Note that Sonos uses the term _room_ ambiguously: on the Sonos app main screen it corresponds to a group, but in the Room Settings it corresponds to a zone.
