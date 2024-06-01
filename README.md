<p align="center">
  <img src="homebridge-zp.png" height="200px" alt="Homebridge ZP Logo">  
</p>
<span align="center">

<a id="homebridge-zp"></a>
# Homebridge ZP
[![Downloads](https://img.shields.io/npm/dt/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp)
[![Version](https://img.shields.io/npm/v/homebridge-zp.svg)](https://www.npmjs.com/package/homebridge-zp)
[![Homebridge Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=discord)](https://discord.gg/3qFgFMk)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

[![GitHub issues](https://img.shields.io/github/issues/ebaauw/homebridge-zp)](https://github.com/ebaauw/homebridge-zp/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/ebaauw/homebridge-zp)](https://github.com/ebaauw/homebridge-zp/pulls)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen)](https://standardjs.com)

</span>

## Homebridge plugin for Sonos Zone Players
Copyright © 2016-2024 Erik Baauw. All rights reserved.

This [Homebridge](https://github.com/homebridge/homebridge) plugin exposes [Sonos](http://www.sonos.com) zone players to Apple's [HomeKit](http://www.apple.com/ios/home/).
It provides the following features:

- Automatic discovery of Sonos zones, taking into account stereo pairs and home theatre setup;
- Support for Sonos groups, created through the Sonos app;
- Control from HomeKit of play/pause, sleep timer, next/previous track, volume, and mute per Sonos group;
- Control from HomeKit of input selection per group, from Sonos favourites and local sources, like LineIn, Airplay;
- Optional control from HomeKit of volume, mute, balance, bass, treble, loudness, night sound, and speech enhancement per Sonos zone, as well as surround/height level etc for home theater configurations;
- Optional control from HomeKit for Sonos zones leaving Sonos groups, and for Sonos zones creating/joining one Sonos group;
- Optional control from HomeKit to enable/disable Sonos alarms;
- Real-time monitoring from HomeKit of state per Sonos group and, optionally, per Sonos zone.
Like the Sonos app, Homebridge ZP subscribes to zone player events to receive notifications;
- Optional control from HomeKit for the status LED and child lock per zone player.
Note that Sonos doesn't support events for these, so Homebridge ZP cannot provide real-time monitoring for this;
- Includes command-line tools, for controlling Sonos zone players and for troubleshooting.

## Contents

* [Prerequisites](#prerequisites)
* [zones](#zones)
* [TV](#tv)
* [TV-Enabled Zones](#tv-enabled-zones)
* [Groups](#groups)
* [Speakers](#speakers)
* [Command-line Tool](#command-line-tool)
* [Installation](#installation)
* [Configuration](#configuration)
* [Troubleshooting](#troubleshooting)
* [Caveats](#caveats)


<a id="prerequisites"></a>
### Prerequisites
You need a server to run Homebridge.

This can be anything running [Node.js](https://nodejs.org): from a Raspberry Pi, a NAS system, or an always-on PC running Linux, macOS, or Windows.
See the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) for details.
I run Homebridge ZP on a Raspberry Pi 3B+.

To interact with HomeKit, you need Siri or a HomeKit app on an iPhone, Apple Watch, iPad, iPod Touch, or Apple TV (4th generation or later).
I recommend to use the latest released versions of iOS, watchOS, and tvOS.  

Please note that Siri and even Apple's [Home](https://support.apple.com/en-us/HT204893) app still provide only limited HomeKit support.
To use the full features of Homebridge Zp, you might want to check out some other HomeKit apps, like the [Eve](https://www.evehome.com/en/eve-app) app (free) or Matthias Hochgatterer's [Home+](https://hochgatterer.me/home/) app (paid).

As Sonos uses UPnP to discover the zone players, the server running Homebridge must be on the same subnet as your Sonos zone players.
As HomeKit uses Bonjour to discover Homebridge, the server running Homebridge must be on the same subnet as your iDevices running HomeKit.
For remote access and for HomeKit automations, you need to setup an Apple TV (4th generation or later), HomePod, or iPad as [home hub](https://support.apple.com/en-us/HT207057).

<a id="zones"></a>
### Zones
Homebridge ZP creates an accessory per Sonos zone, named after the zone, e.g. *Living Room Sonos* for the *Living Room* zone.
By default, this accessory contains a single `Switch` service, with the same name as the accessory.  The standard `On` characteristic is used for play/pause control.
Additional characteristics control volume, select input, change track, etc.
However, neither Apple's Home app nor Siri support these.

To control the volume from Apple's Home app and/or Siri, the type of the service, as well as the type of characteristic used for volume can be changed from `config.json`, see [**Configuration**](#configuration) and [issue #10](https://github.com/ebaauw/homebridge-zp/issues/10).
Note that speaker support in Apple's Home app is based on the AirPlay2 protocol.
Despite the "HomeKit" branding, technically, this has nothing to do with HomeKit.
No Homebridge plugin can expose speakers that look like AirPlay2 speakers in the Home app.
Also note that these Airplay2 speakers cannot be accessed by other HomeKit apps.

<a id="tv"></a>
### TV

When `"tv": true` is set in `config.json`, Homebridge ZP creates an additional *Television* accessory per zone, allowing input selection from Apple's Home app and control from the *Remote* widget.
Note that Apple has imposed some technical restrictions on *Television* accessories:

- They cannot be bridged; they need to be paired to HomeKit individually.
- They cannot be accessed by HomeKit apps; only from Apple's Home app.

<a id="tv-enabled-zones"></a>
### Tv-Enabled Zones
Many Sonos products, such as Amp, Beam, Arc, etc have HDMI inputs on them, which causes Homebridge ZP to think that there is a TV connected to any product which supports TV input. Because there is no reliable way to know if this is the case, the plugin allows you to customize what zones actually have a TV connected. All zones are enabled by default, and disabling a zone will cause it's TV audio input to be hidden within Homekit. The zone names will auto-populate anytime HomeBridge is restarted, and will create a boolian for each zone in your config. The easiest way to define this is by using [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x) or manually by adding "tvEnabledZones": {
            }
to your config.json, like this:

```json
            "tvEnabledZones": {
                "Patio": false,
                "Kitchen": false,
                "Living Room": true,
                "Master Bathroom": false,
                "Master Bedroom": true
            },
            "platform": "ZP"
```


<a id="groups"></a>
### Groups
When you combine Sonos zones, such as *Living Room* and *Kitchen*, into one group, the Sonos app shows them as a single room, e.g. *Living Room + 1*. This allows you to control both rooms together for play/pause, music source, and volume/mute. When you ungroup them, each room goes back to being separate, with its own controls.

If Homebridge ZP would mimic this behaviour, dynamically creating and deleting accessories for groups, HomeKit would lose the assignment to HomeKit rooms, groups, scenes, and automations, every time an accessory is deleted. Consequently, you would have to reconfigure HomeKit each time you group or ungroup Sonos zones.

To overcome this, Homebridge ZP creates an accessory for each Sonos zone, which manages the group the zone belongs to. When zones are separate, the controls for *Living Room* only effect the *Living Room* zone, and the controls for *Kitchen* only effect the *Kitchen* zone. When the zones are grouped, controls in any zone in that group will effect all speakers in the group e.g. *Living Room + 1*.

The `Sonos Group` characteristic shows which group a speaker belongs to by displaying the name of the main speaker in the group, like *Living Room*.

So, when grouped, adjusting the *Living Room* volume changes the volume for both *Living Room* and *Kitchen*. The same happens if you adjust the volume for *Kitchen*. When ungrouped, changing the *Living Room* volume only affects *Living Room*, and changing the *Kitchen* volume only affects *Kitchen*.

<a id="speakers"></a>
### Speakers
To change the volume of an individual zone in a multi-zone group, an additional `Volume` characteristic is needed for the zone, next to the `Volume` characteristic for the group.
As HomeKit doesn't support multiple characteristics of the same type per service, it actually requires an additional service.
By specifying `"speakers": true` in `config.json`, Homebridge ZP creates an additional *Speakers* service for each zone accessory, to control the individual zone.  This service is named after the zone as well, in our example: *Living Room Speakers*.

The *Speakers* service `On` characteristic is used to join, or leave a Sonos group.
`On` is set, when the zone is a member of other zone's group.
It is clear, when the zone is the coordinator of it's own group (either standalone or with other zones as member).
By setting `On`, the zone will join groups with the target coordinator.
The target coordinator is set using the `Sonos Coordinator` characteristic in the *Sonos* service.
By clearing `On`, the zone will leave the group and become coordinator of a standalone group.

Additional characteristics for `Volume`, `Mute`, `Bass`, `Treble`, and `Loudness` control the corresponding zone attributes.
Note that `Bass`, `Treble`, and `Loudness` are custom characteristics.  They might not be supported by all HomeKit apps, see **Caveats** below.

Like the *Sonos* service, the type of the *Speakers* service can be changed in `config.json` from the default `Switch`.

<a id="command-line-tool"></a>
### Command-Line Tool
Homebridge ZP includes a command-line tool, `zp`, to interact with your Sonos Zone Players from the command line.
It takes a `-h` or `--help` argument to provide a brief overview of its functionality and command-line arguments.

<a id="installation"></a>
### Installation
To install Homebridge ZP:

- Follow the instructions on the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) to install Node.js and Homebridge
- Install the Homebridge ZP plugin through [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x) or manually by:
  ```
  $ sudo npm -g i homebridge-zp
  ```
- Edit `config.json` and add the `ZP` platform provided by Homebridge ZP, see [**Configuration**](#configuration).

<a id="configuration"></a>
### Configuration
In Homebridge's `config.json` you need to specify Homebridge ZP as a platform plugin:
```json
  "platforms": [
    {
      "platform": "ZP"
    }
  ]
```
The following optional parameters can be added to modify Homebridge ZP's behaviour:

Key | Default | Description
--- | ------- | -----------
`address` | _(discovered)_ | The IP address for the web server Homebridge ZP creates to receive notifications from Sonos zone players.  This must be an IP address of the server running Homebridge ZP, reachable by the zone players.  You might need to set this on a multi-homed server, if Homebridge ZP binds to the wrong network interface.
`alarms` | `false` | Flag whether to expose an additional service per Sonos alarm.
`brightness` | `false` | Flag whether to expose volume as Brightness when "service" is "switch" or "speaker".  Setting this flag enables volume control from Siri, but not from Apple's Home app.
`excludeAirPlay` | `false` | Flag whether not to expose zone players that support Airplay, since they natively show up in Apple's Home app.  Note that if you only have an S2 system, enabling this option will essentially render the plugin unusable, as all zones will be hidden from Homekit.
`forceS2` | `false` | Flag whether to expose only S2 zone players.  See [**Split Sonos System**](#split-sonos-system) below.
`filterFavourites` | `false` | Flag whether or not to exclude audio inputs from the favourites list in Homekit.  see [**TV**](#tv) for details.
`tvEnabledZones` | `dynamically updated` | Object key to specify whether a zone will show a TV audio input in Homekit.  see [**TV-Enabled Zones**](#tv-enabled-zones) for details.
`heartrate` | (disabled) | Interval (in seconds) to poll zone players when `leds` is set.
`leds` | `false` | Flag whether to expose an additional *Lightbulb* service per zone for the status LED.  This also supports locking the physical controls.
`nameScheme` | `"% Sonos"` | The name scheme for the HomeKit accessories.  `%` is replaced with the zone name.  E.g. with the default name scheme, the accessory for the `Kitchen` zone is set to `Kitchen Sonos`.  Note that this does _not_ change the names of the HomeKit services, used by Siri.
`port` | `0` _(random)_ | The port for the web server Homebridge ZP creates to receive notifications from Sonos zone players.
`resetTimeout` | `500` | Timeout (in milliseconds) to reset input (e.g. _Change Volume_).
`service` | `"switch"` | Defines what type of service and volume characteristic Homebridge ZP uses.  Possible values are: `"switch"` for `Switch` and `Volume`; `"speaker"` for `Speaker` and `Volume`; `"light"` for `LightBulb` and `Brightness`; and `"fan"` for `Fan` and `Rotation Speed`.  Selecting `"light"` or `"fan"` enables changing the Sonos volume from Siri and from Apple's Home app.  Selecting `"speaker"` results in a *not supported* accessory in Apple's Home app.
`speakers` | `false` | Flag whether to expose a second *Speakers* service per zone, in addition to the standard *Sonos* service, see [**Speakers**](#speakers).  You might want to set this if you're using Sonos groups in a configuration of multiple Sonos zones.
`subscriptionTimeout` | `30` | The duration (in minutes) of the subscriptions Homebridge ZP creates with each zone player.
`timeout` | `15` | The timeout (in seconds) to wait for a response from a Sonos zone player.
`tv` | `false` | Create an additional, non-bridged TV accessory for each zone.<br>Note that each TV accessory needs to be paired with HomeKit separately, using the same pin as for Homebridge, as specified in `config.json`.  see [**TV**](#tv) for more details.
`tvIdPrefix` | `TV` | Prefix for serial number of TV accessories, to enable multiple instances of Homebridge ZP on the same network.

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

<a id="split-sonos-system"></a>
#### Split Sonos System
If you have a split Sonos system, Homebridge ZP will expose both the S2 and the S1 zone players.
Of course you can only group S2 zone players with other S2 zone players; and S1 zone players with other S1 zone players.  
The same restriction applies when you have multiple Sonos households on your network: you can only group zone players with other zone players in the same household.

<a id="troubleshooting"></a>
### Troubleshooting

<a id="check-dependencies"></a>
#### Check Dependencies
If you run into Homebridge startup issues, please double-check what versions of Node.js and of Homebridge have been installed.
Homebridge ZP has been developed and tested using the [latest LTS](https://nodejs.org/en/about/releases/) version of Node.js and the [latest](https://www.npmjs.com/package/homebridge) version of Homebridge.
Other versions might or might not work - I simply don't have the bandwidth to test these.

<a id="run-homebridge-zp-solo"></a>
#### Run Homebridge ZP Solo
If you run into Homebridge startup issues, please run a separate instance of Homebridge with only Homebridge ZP (and Homebridge Config UI X) enabled in `config.json`.
This way, you can determine whether the issue is related to Homebridge ZP itself, or to the interaction of multiple Homebridge plugins in your setup.
You can start this separate instance of Homebridge on a different system, as a different user, or from a different user directory (specified by the `-U` flag).
Make sure to use a different Homebridge `name`, `username`, and (if running on the same system) `port` in the `config.json` for each instance.

<a id="debug-log-file"></a>
#### Debug Log File
Homebridge ZP outputs an info message for each HomeKit characteristic value it sets and for each HomeKit characteristic value change notification it receives.
When Homebridge is started with `-D`, Homebridge ZP outputs a debug message for each request it makes to a Sonos zone player and for each zone player notification event it receives.

To capture these messages into a log file do the following:
- If you're running Homebridge as a service, stop that service;
- Run Homebridge manually, capturing the output into a file, by issuing:
  ```
  $ homebridge -CD 2>&1 | tee homebridge.log
  ```
- Interact with your devices, through their native app and or through HomeKit to trigger the issue;
- Hit interrupt (ctrl-C) to stop Homebridge;
- If you're running Homebridge as a service, restart the service;
- Compress the log file by issuing:
  ```
  $ gzip homebridge.log
  ```

<a id="web-server"></a>
#### Web Server
Like the Sonos app, Homebridge ZP subscribes to the zone player events to be notified in real-time of changes.  It creates a web server to receive these notifications.  The IP address and port number for this listener are logged in a debug message, e.g.
```
[1/1/2020, 11:58:35 AM] [Sonos] listening on http://192.168.x.x:58004/notify
```
To check whether the listener is reachable from the network, open this URL in your web browser.  You should see an overview of the active subscriptions per zone player.

<a id="getting-help"></a>
#### Getting Help
If you have a question, please post a message to the **#zp** channel of the Homebridge community on [Discord](https://discord.gg/3qFgFMk).

If you encounter a problem, please open an issue on [GitHub](https://github.com/ebaauw/homebridge-zp/issues).
Please **attach** a copy of `homebridge.log.gz` to the issue, see [**Debug Log File**](#debug-log-file).
Please do **not** copy/paste large amounts of log output.

<a id="caveats"></a>
### Caveats
Homebridge ZP is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for years, but your mileage might vary.

The HomeKit terminology needs some getting used to.
An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.
A _bridge_ (like Homebridge) is an accessory that provides access to other, bridged, accessories.
An accessory might provide multiple _services_.
Each service corresponds to a virtual device (like a lightbulb, switch, motion sensor, ..., but also: a programmable switch button, accessory information, battery status).
Siri interacts with services, not with accessories.
A service contains one or more _characteristics_.
A characteristic is like a service attribute, which might be read or written by HomeKit apps.
You might want to checkout Apple's [HomeKit Accessory Simulator](https://developer.apple.com/documentation/homekit/testing_your_app_with_the_homekit_accessory_simulator), which is distributed as an additional tool for `Xcode`.

The Sonos terminology needs some getting used to.
A _zone_ corresponds to a physical room.
It consists of a single zone player, two zone players configured as a stereo pair, or a home theatre setup (e.g. a PlayBar with separate surround speakers).
Typically, zone setup is static; you would only change it when physically re-arranging your zone players between rooms.
A _zone group_ is a collection of one or more zones, playing the same music in sync.
A zone group is controlled by its _coordinator_ zone.
Typically, groups are dynamic, you add and/or remove zones to/from a group when listening to your music.
Controls for play/pause and music source act on a zone group.
Controls for volume and mute act on a zone group or on a single zone.
Controls for bass, treble, and loudness act on a single zone.
Note that Sonos uses the term _room_ ambiguously: on the Sonos app main screen it corresponds to a zone group, but in the Room Settings it corresponds to a zone.
