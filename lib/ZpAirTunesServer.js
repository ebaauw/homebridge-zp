// homebridge-zp/lib/ZpAirTunesServer.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.
//
// AirTunes server for Sonos ZonePlayer.
// Adapted from Airsonos, see https://github.com/stephen/airsonos
//
// TODO:
// - Bonjour advertisement isn't cancelled
// - Move to pure Javascript MDNS

'use strict'

const NodeTunes = require('nodetunes-zp')
const Nicercast = require('./Nicercast')

module.exports = class ZpAirTunesServer {
  constructor (zpAccessory) {
    this.log = zpAccessory.log
    this.name = zpAccessory.name
    this.zp = zpAccessory.zp
    this.zpAccessory = zpAccessory
    this.ipaddress = zpAccessory.platform.server.address().address
    this.clientName = 'AirSonos'
    this.started = false
    this.log.debug('%s: AirTunes init', this.name)

    this.AirTunesServer = new NodeTunes({
      serverName: this.name,
      macAddress: this.zp.id.substr(7, 12)
    })

    this.AirTunesServer.on('error', (error) => {
      this.log.error(error)
    })

    this.AirTunesServer.on('clientNameChange', (name) => {
      this.log.debug('%s: AirTunes client name changed to %s', this.name, name)
      this.clientName = 'Airsonos @' + name
    })

    this.AirTunesServer.on('clientConnected', (audiostream) => {
      this.log.debug('%s: AirTunes client connected', this.name)
      this.icecastServer = new Nicercast(audiostream, {
        name: this.clientName, ipaddress: this.ipaddress
      })
      this.icecastServer.start(0, (port) => {
        const uri = 'x-rincon-mp3radio://' + this.ipaddress + ':' + port +
          '/AirTunes.m3u'
        this.zp.playWithoutQueue(uri, (err, success) => {
          if (err || !success) {
            this.log.error('%s: play: %s', this.name, err)
          }
        })
      })
    })

    this.AirTunesServer.on('clientDisconnected', () => {
      this.log.debug('%s: AirTunes client disconnected', this.name)
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

    this.AirTunesServer.on('volumeChange', (volume) => {
      this.volume = 100 - Math.floor(-1 * (Math.max(volume, -30) / 30) * 100)
      if (this.volumeTimer == null) {
        this.volumeTimer = setTimeout(this.setVolume.bind(this), 200)
      }
    })

    this.AirTunesServer.on('metadataChange', (metadata) => {
      this.log.debug('%s: AirTunes metatdata: %j', this.name, metadata)
      if (metadata.minm) {
        const asarPart = metadata.asar ? `${metadata.asar} - ` : '' // artist
        // const asalPart = metadata.asal ? ` (${metadata.asal})` : '' // album
        this.icecastServer.setMetadata(asarPart + metadata.minm)
      }
    })
  }

  start () {
    if (this.AirTunesServer != null) {
      this.log.debug('%s: AirTunes server start', this.name)
      this.AirTunesServer.start()
      this.started = true
    }
  }

  stop () {
    if (this.started) {
      this.log.debug('%s: AirTunes server stop', this.name)
      this.started = false
      this.AirTunesServer.stop()
    }
    if (this.icecastServer != null) {
      this.icecastServer.stop()
      this.icecastServer = null
    }
  }

  setVolume () {
    this.volumeTimer = null
    this.log.debug('%s: AirTunes volume changed to %d', this.name, this.volume)
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
