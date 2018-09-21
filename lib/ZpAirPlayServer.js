// homebridge-zp/lib/ZpairPlayServer.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.
//
// Airplay1 tunnel to Sonos Zone.
// Adapted from Airsonos, see https://github.com/stephen/airsonos
//
// TODO:
// - Throttle group volume updates;
// - Fix metadata not displaying (issue with nicercast?)
// - Bonjour advertisement isn't cancelled
// - Move to pure Javascript MDNS

'use strict'

const NodeTunes = require('nodetunes')
const Nicercast = require('nicercast')

module.exports = class ZpairPlayServer {
  constructor (zpAccessory) {
    this.log = zpAccessory.log
    this.name = zpAccessory.name
    this.zp = zpAccessory.zp
    this.zpAccessory = zpAccessory
    this.ipaddress = zpAccessory.platform.server.address().address
    this.clientName = 'AirSonos'
    this.started = false
    this.log.debug('%s: Airplay init', this.name)

    this.airPlayServer = new NodeTunes({ serverName: this.name })

    this.airPlayServer.on('error', (error) => {
      this.log.error(error)
    })

    this.airPlayServer.on('clientNameChange', (name) => {
      this.log.debug('%s: Airplay client name changed to %s', this.name, name)
      this.clientName = 'Airsonos @' + name
    })

    this.airPlayServer.on('clientConnected', (audiostream) => {
      this.log.debug('%s: Airplay client connected', this.name)
      this.icecastServer = new Nicercast(audiostream, { name: this.clientName })
      this.icecastServer.start(0, (port) => {
        this.zp.playWithoutQueue({
          uri: 'x-rincon-mp3radio://' + this.ipaddress + ':' + port + '/listen.m3u',
          metatdata: `<?xml version="1.0"?>
<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
<item id="R:0/0/49" parentID="R:0/0" restricted="true">
<dc:title>${this.name}</dc:title>
<upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON65031_</desc>
</item>
</DIDL-Lite>`
        }, (err, success) => {
          if (err || !success) {
            this.log.error('%s: play: %s', this.name, err)
          }
        })
      })
    })

    this.airPlayServer.on('clientDisconnected', () => {
      this.log.debug('%s: Airplay client disconnected', this.name)
      this.zp.stop((err, success) => {
        if (err || !success) {
          this.log.error('%s: stop: %s', this.name, err)
        }
      })
      if (this.icecastServer != null) {
        this.icecastServer.stop()
        this.icecastServer = null
      }
    })

    this.airPlayServer.on('volumeChange', (vol) => {
      const targetVol = 100 - Math.floor(-1 * (Math.max(vol, -30) / 30) * 100)
      this.log.debug('%s: Airplay volume changed to %d', this.name, targetVol)
      this.zp.setVolume(targetVol + '', (err, data) => {
        if (err) {
          this.log.error('%s: set volume: %s', this.name, err)
        }
      })
      // const args = {
      //   InstanceID: 0,
      //   DesiredVolume: targetVol + ''
      // }
      // this.zpAccessory.groupRenderingControl._request('SetGroupVolume', args, (err, status) => {
      //   if (err) {
      //     this.log.error('%s: set group volume: %s', this.name, err)
      //   } else {
      //     this.log('%s: Airplay volume set to %d', this.name, targetVol)
      //   }
      // })
    })

    this.airPlayServer.on('metadataChange', (metadata) => {
      this.log.debug('%s: Airplay metatdata: %j', this.name, metadata)
      if (metadata.minm) {
        const asarPart = metadata.asar ? ` - ${metadata.asar}` : '' // artist
        const asalPart = metadata.asal ? ` (${metadata.asal})` : '' // album
        this.icecastServer.setMetadata(metadata.minm + asarPart + asalPart)
      }
    })
  }

  start () {
    if (this.airPlayServer != null) {
      this.log.debug('%s: Airplay server start', this.name)
      this.airPlayServer.start()
      this.started = true
    }
  }

  stop () {
    if (this.started) {
      this.log.debug('%s: Airplay server stop', this.name)
      this.started = false
      this.airPlayServer.stop()
    }
    if (this.icecastServer != null) {
      this.icecastServer.stop()
      this.icecastServer = null
    }
  }
}
