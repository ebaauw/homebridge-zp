// homebridge-zp/lib/ZpService/Sonos.js
// Copyright © 2016-2024 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import he from 'he'

import { ZpService } from './index.js'

class Sonos extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' Sonos'
    params.Service = zpAccessory.platform.config.SpeakerService
    params.subtype = 'group'
    super(zpAccessory, params)
    this.debug('Sonos service')
    this.zpClient.on('message', (message) => {
      try {
        const f = `handle${message.device}${message.service}Event`
        if (this[f] != null) {
          this[f](message.parsedBody)
        }
      } catch (error) {
        this.error(error)
      }
    })
    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: async (value) => {
        try {
          if (value === this.values.on) {
            return
          }
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (
            value &&
            coordinatorValues.currentTransportActions.includes('Play') &&
            coordinatorValues.currentTrack !== 'TV'
          ) {
            await this.zpAccessory.coordinator.zpClient.play()
            const duration = this.values.setDuration <= 10
              ? ''
              : new Date(this.values.setDuration * 1000)
                .toISOString().slice(11, 19)
            await this.zpAccessory.coordinator.zpClient.setSleepTimer(duration)
          } else if (
            !value &&
            coordinatorValues.currentTransportActions.includes('Pause')
          ) {
            await this.zpAccessory.coordinator.zpClient.pause()
          } else if (
            !value &&
            coordinatorValues.currentTransportActions.includes('Stop')
          ) {
            await this.zpAccessory.coordinator.zpClient.stop()
          } else {
            setTimeout(() => {
              this.values.on = !value
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      },
      timeout: 5000
    })
    this.addCharacteristicDelegate({
      key: 'setDuration',
      Characteristic: this.Characteristics.hap.SetDuration,
      silent: true,
      unit: 's',
      props: { maxValue: 86399 }, // 23:59:59
      value: 0
    }).on('didSet', (value) => {
      if (value <= 10) {
        setTimeout(() => {
          this.values.setDuration = 0
        }, this.platform.config.resetTimeout)
      }
    })
    this.addCharacteristicDelegate({
      key: 'remainingDuration',
      Characteristic: this.Characteristics.hap.RemainingDuration,
      unit: 's',
      props: { maxValue: 86399 }, // 23:59:59
      getter: async (value) => {
        try {
          if (this.zpAccessory.coordinator == null) {
            return 0
          }
          const timer = await this.zpAccessory.coordinator.zpClient.getSleepTimer()
          if (timer === '') {
            return 0
          }
          return timer.split(':').reduce((value, time) => {
            return 60 * value + +time
          })
        } catch (error) {
          this.error(error)
          return 0
        }
      },
      timeout: 2000
    })
    this.addCharacteristicDelegate({
      key: 'volume',
      Characteristic: this.platform.config.VolumeCharacteristic,
      unit: '%',
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setGroupVolume(value)
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'changeVolume',
      Characteristic: this.Characteristics.my.ChangeVolume,
      value: 0,
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setRelativeGroupVolume(value)
        } catch (error) {
          this.error(error)
        }
        setTimeout(() => {
          this.values.changeVolume = 0
        }, this.platform.config.resetTimeout)
      }
    })
    this.addCharacteristicDelegate({
      key: 'mute',
      Characteristic: this.Characteristics.hap.Mute,
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setGroupMute(value)
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'currentValidPlayModes',
      silent: true,
      value: []
    })
    this.addCharacteristicDelegate({
      key: 'repeat',
      Characteristic: this.Characteristics.my.Repeat,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (
            value === 0 || coordinatorValues.currentValidPlayModes.includes(
              value === 1 ? 'REPEATONE' : 'REPEAT'
            )
          ) {
            await this.zpAccessory.coordinator.zpClient.setRepeat(
              ['off', '1', 'on'][value]
            )
          } else {
            setTimeout(() => {
              this.values.repeat = 0
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'shuffle',
      Characteristic: this.Characteristics.my.Shuffle,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (!value || coordinatorValues.currentValidPlayModes.includes('SHUFFLE')) {
            await this.zpAccessory.coordinator.zpClient.setShuffle(value)
          } else {
            setTimeout(() => {
              this.values.shuffle = false
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'crossfade',
      Characteristic: this.Characteristics.my.Crossfade,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (!value || coordinatorValues.currentValidPlayModes.includes('CROSSFADE')) {
            await this.zpAccessory.coordinator.zpClient.setCrossfadeMode(value)
          } else {
            setTimeout(() => {
              this.values.crossfade = false
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'currentTrack',
      Characteristic: this.Characteristics.my.CurrentTrack
    })
    this.addCharacteristicDelegate({
      key: 'uri',
      silent: true
    })
    this.addCharacteristicDelegate({
      key: 'currentTransportActions',
      silent: true,
      value: []
    })
    this.addCharacteristicDelegate({
      key: 'changeTrack',
      Characteristic: this.Characteristics.my.ChangeTrack,
      value: 0,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (
            value > 0 &&
            coordinatorValues.currentTransportActions.includes('Next')
          ) {
            await this.zpAccessory.coordinator.zpClient.next()
          } else if (
            value < 0 &&
            coordinatorValues.currentTransportActions.includes('Previous')
          ) {
            await this.zpAccessory.coordinator.zpClient.previous()
          }
        } catch (error) {
          this.error(error)
        }
        setTimeout(() => {
          this.values.changeTrack = 0
        }, this.platform.config.resetTimeout)
      }
    })
    if (this.platform.config.tv) {
      this.addCharacteristicDelegate({
        key: 'activeIdentifier',
        Characteristic: this.Characteristics.hap.ActiveIdentifier,
        props: { maxValue: this.platform.config.maxFavourites },
        setter: async (value) => {
          this.platform.zpTvs[this.zpClient.id].tvService
            .characteristicDelegate('activeIdentifier').setValue(value)
        }
      })
      this.addCharacteristicDelegate({
        key: 'changeInput',
        Characteristic: this.Characteristics.my.ChangeInput,
        value: 0,
        setter: async (value) => {
          setTimeout(() => {
            this.values.changeInput = 0
          }, this.platform.config.resetTimeout)
        }
      })
    }
    if (this.zpClient.tvIn) {
      this.addCharacteristicDelegate({
        key: 'tv',
        Characteristic: this.Characteristics.my.Tv
      })
    }
    this.addCharacteristicDelegate({
      key: 'sonosGroup',
      Characteristic: this.Characteristics.my.SonosGroup,
      value: ''
    })
    this.addCharacteristicDelegate({
      key: 'sonosCoordinator',
      Characteristic: this.Characteristics.my.SonosCoordinator,
      value: false,
      setter: async (value) => {
        try {
          if (value) {
            this.platform.setPlatformCoordinator(this.zpAccessory)
            if (this.zpAccessory.coordinator !== this.zpAccessory) {
              this.zpAccessory.coordinator.zpClient.delegateGroupCoordinationTo(
                this.zpClient.id
              )
            }
          } else {
            setTimeout(() => {
              this.values.sonosCoordinator = true
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'platformCoordinatorId',
      silent: true
    })
    if (this.values.sonosCoordinator) {
      this.platform.setPlatformCoordinator(this.zpAccessory)
    }
    this.addCharacteristicDelegate({
      key: 'logLevel',
      Characteristic: this.Characteristics.my.LogLevel,
      props: { maxValue: 4 },
      value: this.accessoryDelegate.logLevel
    })
    this.addCharacteristicDelegate({
      key: 'lastSeen',
      Characteristic: this.Characteristics.my.LastSeen,
      value: 'n/a',
      silent: true
    })
    this.addCharacteristicDelegate({
      key: 'statusFault',
      Characteristic: this.Characteristics.hap.StatusFault,
      value: this.Characteristics.hap.StatusFault.GENERAL_FAULT
    })

    this.values.statusFault = this.Characteristics.hap.StatusFault.GENERAL_FAULT
    this.emit('initialised')

    zpAccessory.once('initialised', async () => {
      try {
        await this.zpClient.subscribe('/MediaRenderer/AVTransport/Event')
        await this.zpClient.subscribe('/MediaRenderer/GroupRenderingControl/Event')
      } catch (error) {
        this.error(error)
      }
    })
  }

  handleMediaRendererAVTransportEvent (message) {
    if (
      message.lastChange == null ||
      !Array.isArray(message.lastChange) ||
      message.lastChange[0] == null
    ) {
      return
    }
    if (this.zpAccessory.isCoordinator === false) {
      this.zpAccessory.leaving = true
    }
    const event = message.lastChange[0]
    let on
    let tv = false
    let track
    let currentTransportActions
    let repeat
    let shuffle
    let crossfade
    let currentValidPlayModes
    let uri
    const state = event.transportState
    if (state != null) {
      on = state === 'PLAYING' || state === 'TRANSITIONING'
    }
    const meta = event.currentTrackMetaData
    // this.debug('currentTrackMetaData: %j', meta)
    if (event.currentTrackUri != null && event.currentTrackUri !== '') {
      switch (event.currentTrackUri.split(':')[0]) {
        case 'x-rincon-buzzer': // Sonos Chime
          track = 'Sonos Chime'
          uri = event.currentTrackUri
          break
        case 'x-sonos-vli': // AirPlay
        case 'x-sonosapi-vli': // Airplay ???
          track = meta.title
          uri = event.currentTrackUri.split(',')[0]
          break
        case 'x-rincon-stream': // Line in input.
          track = meta.title
          uri = event.currentTrackUri
          break
        case 'x-sonos-htastream': // SPDIF TV input.
          track = 'TV'
          tv = meta.streamInfo !== 0 // 0: no input; 2: stereo; 18: Dolby 5.1; 22: ?
          uri = event.currentTrackUri
          break
        case 'aac': // Radio stream (e.g. DI.fm)
        case 'x-sonosapi-stream': // Radio stream.
        case 'x-rincon-mp3radio': // AirTunes (by homebridge-zp).
          track = meta.streamContent // info
          if (track === '') {
            if (event.enqueuedTransportUriMetaData != null) {
              track = event.enqueuedTransportUriMetaData.title // station
            }
          }
          break
        case 'hls-radio': { // Radio stream, see #125.
          const a = /^TYPE=SNG\|TITLE (.*)\|ARTIST (.*)\|ALBUM/.exec(meta.streamContent)
          if (a != null) {
            track = a[2] === '' ? a[1] : a[2] + ' - ' + a[1]
          } else if (event.enqueuedTransportUriMetaData != null) {
            track = event.enqueuedTransportUriMetaData.title // station
          }
        }
          break
        case 'x-file-cifs': // Library song.
        case 'x-sonos-http': // See issue #44.
        case 'http': // Song on iDevice.
        case 'https': // Apple Music, see issue #68
        case 'x-sonos-spotify': // Spotify song.
        case 'x-sonosprog-http': // Apple Music, see issue #125
        case 'x-sonosapi-rtrecent': // ??
          if (meta.title != null) {
            track = meta.title // song
          }
          break
        case 'x-sonosapi-hls': // ??
        case 'x-sonosapi-hls-static': // e.g. Amazon Music
          // Skip! update will arrive in subsequent CurrentTrackMetaData events
          // and will be handled by default case
          break
        case 'x-rincon': // zone group
          // skip - handled by coordinator
          break
        default:
          this.warn('unknown uri: %j', event.currentTrackUri)
          if (meta.title != null) {
            track = meta.title // song
          } else {
            track = ''
          }
          break
      }
    }
    if (
      event.enqueuedTransportUri != null && event.enqueuedTransportUri !== ''
    ) {
      uri = event.enqueuedTransportUri // playlist
    }
    if (event.currentTransportActions != null) {
      currentTransportActions = event.currentTransportActions.split(', ')
      if (currentTransportActions.length === 1) {
        track = ''
      }
    }
    if (
      event.sleepTimerGeneration != null &&
      this.zpAccessory.coordinator === this.zpAccessory
    ) {
      this.zpClient.getSleepTimer().then((timer) => {
        const value = timer === ''
          ? 0
          : timer.split(':').reduce((value, time) => {
            return 60 * value + +time
          })
        this.values.remainingDuration = value
        for (const member of this.zpAccessory.members()) {
          member.sonosService.values.remainingDuration =
            this.values.remainingDuration
        }
      }).catch((error) => { this.error(error) })
    }
    if (on != null) {
      this.values.on = on
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.on = this.values.on
      }
    }
    if (
      track != null &&
      track !== 'ZPSTR_CONNECTING' && track !== 'ZPSTR_BUFFERING'
    ) {
      this.values.currentTrack = track.slice(0, 64)
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentTrack = this.values.currentTrack
      }
    }
    if (event.currentValidPlayModes != null) {
      currentValidPlayModes = event.currentValidPlayModes.split(',')
    }
    if (event.currentPlayMode != null) {
      if (event.currentPlayMode === 'NORMAL') {
        repeat = 0
        shuffle = false
      } else if (event.currentPlayMode === 'REPEAT_ONE') {
        repeat = 1
        shuffle = false
      } else if (event.currentPlayMode === 'REPEAT_ALL') {
        repeat = 2
        shuffle = false
      } else if (event.currentPlayMode === 'SHUFFLE_NOREPEAT') {
        repeat = 0
        shuffle = true
      } else if (event.currentPlayMode === 'SHUFFLE_REPEAT_ONE') {
        repeat = 1
        shuffle = true
      } else if (event.currentPlayMode === 'SHUFFLE') {
        repeat = 2
        shuffle = true
      }
    }
    if (event.currentCrossfadeMode != null) {
      crossfade = event.currentCrossfadeMode === 1
    }
    if (tv != null) {
      if (tv !== this.values.tv) {
        if (tv || this.values.tv == null || track !== 'TV') {
          this.values.tv = tv
        } else {
          this.tvTimer = setTimeout(() => {
            this.tvTimer = null
            this.values.tv = tv
          }, 10000)
        }
      } else if (this.tvTimer != null) {
        clearTimeout(this.tvTimer)
        this.tvTimer = null
      }
    }
    if (currentTransportActions != null) {
      this.values.currentTransportActions = currentTransportActions
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentTransportActions =
          this.values.currentTransportActions
      }
    }
    if (currentValidPlayModes != null) {
      this.values.currentValidPlayModes = currentValidPlayModes
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentValidPlayModes =
          this.values.currentValidPlayModes
      }
    }
    if (repeat != null) {
      this.values.repeat = repeat
      this.values.shuffle = shuffle
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.repeat = this.values.repeat
        member.sonosService.values.shuffle = this.values.shuffle
      }
    }
    if (crossfade != null) {
      this.values.crossfade = crossfade
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.crossfade = this.values.crossfade
      }
    }
    if (uri != null) {
      this.values.uri = he.escape(uri)
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.uri = this.values.uri
      }
    }
  }

  handleMediaRendererGroupRenderingControlEvent (message) {
    if (message.groupVolume != null) {
      this.values.volume = message.groupVolume
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.volume = this.values.volume
      }
    }
    if (message.groupMute != null) {
      this.values.mute = !!message.groupMute
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.mute = this.values.mute
      }
    }
  }
}

ZpService.Sonos = Sonos
