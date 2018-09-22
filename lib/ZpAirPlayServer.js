// homebridge-zp/lib/ZpAirPlayServer.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.
//
// AirTunes tunnel to Sonos Zone.
// Adapted from Airsonos, see https://github.com/stephen/airsonos
//
// TODO:
// - Bonjour advertisement isn't cancelled
// - Move to pure Javascript MDNS

'use strict'

const NodeTunes = require('nodetunes-zp')
const Nicercast = require('./Nicercast')

module.exports = class ZpAirPlayServer {
  constructor (zpAccessory) {
    this.log = zpAccessory.log
    this.name = zpAccessory.name
    this.zp = zpAccessory.zp
    this.zpAccessory = zpAccessory
    this.ipaddress = zpAccessory.platform.server.address().address
    this.clientName = 'AirSonos'
    this.started = false
    this.log.debug('%s: Airplay init', this.name)

    this.airPlayServer = new NodeTunes({
      serverName: this.name,
      macAddress: this.zp.id.substr(7, 12)
    })

    this.airPlayServer.on('error', (error) => {
      this.log.error(error)
    })

    this.airPlayServer.on('clientNameChange', (name) => {
      this.log.debug('%s: Airplay client name changed to %s', this.name, name)
      this.clientName = 'Airsonos @' + name
    })

    this.airPlayServer.on('clientConnected', (audiostream) => {
      this.log.debug('%s: Airplay client connected', this.name)
      this.icecastServer = new Nicercast(audiostream, {
        name: this.clientName, ipaddress: this.ipaddress
      })
      this.icecastServer.start(0, (port) => {
        const uri = 'x-rincon-mp3radio://' + this.ipaddress + ':' + port +
          '/AirPlay.m3u'
        this.zp.playWithoutQueue(uri, (err, success) => {
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

    this.airPlayServer.on('volumeChange', (volume) => {
      this.volume = 100 - Math.floor(-1 * (Math.max(volume, -30) / 30) * 100)
      if (this.volumeTimer == null) {
        this.volumeTimer = setTimeout(this.setVolume.bind(this), 200)
      }
    })

    this.airPlayServer.on('metadataChange', (metadata) => {
      this.log.debug('%s: Airplay metatdata: %j', this.name, metadata)
      if (metadata.minm) {
        const asarPart = metadata.asar ? `${metadata.asar} - ` : '' // artist
        // const asalPart = metadata.asal ? ` (${metadata.asal})` : '' // album
        this.icecastServer.setMetadata(asarPart + metadata.minm)
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

  setVolume () {
    this.volumeTimer = null
    this.log.debug('%s: Airplay volume changed to %d', this.name, this.volume)
    const args = {
      InstanceID: 0,
      DesiredVolume: this.volume + ''
    }
    this.zpAccessory.groupRenderingControl._request('SetGroupVolume', args, (err, status) => {
      if (err) {
        this.log.error('%s: set group volume: %s', this.name, err)
      }
    })
  }
}
