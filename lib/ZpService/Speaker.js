// homebridge-zp/lib/ZpService/Speaker.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpService } from './index.js'

class Speaker extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' Speakers'
    params.Service = zpAccessory.platform.config.SpeakerService
    params.subtype = 'zone'
    super(zpAccessory, params)
    this.debug('Speaker service')
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
          const platformCoordinator = this.platform.coordinators[this.zpClient.household]
          if (platformCoordinator === this.zpAccessory) {
            setTimeout(() => {
              this.values.on = false
            }, this.platform.config.resetTimeout)
            return
          }
          if (value) {
            const coordinator = platformCoordinator
            if (coordinator != null) {
              return this.zpClient.setAvTransportGroup(coordinator.zpClient.id)
            } else {
              // No coordinator yet.
              setTimeout(() => {
                this.values.on = false
              }, this.platform.config.resetTimeout)
            }
          } else {
            return this.zpClient.becomeCoordinatorOfStandaloneGroup()
          }
        } catch (error) {
          this.error(error)
        }
      },
      timeout: 5000
    })
    this.addCharacteristicDelegate({
      key: 'volume',
      Characteristic: this.platform.config.VolumeCharacteristic,
      unit: '%',
      setter: this.zpClient.setVolume.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'changeVolume',
      Characteristic: this.Characteristics.my.ChangeVolume,
      value: 0,
      setter: async (value) => {
        try {
          await this.zpClient.setRelativeVolume(value)
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
      setter: this.zpClient.setMute.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'loudness',
      Characteristic: this.Characteristics.my.Loudness,
      setter: this.zpClient.setLoudness.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'bass',
      Characteristic: this.Characteristics.my.Bass,
      setter: this.zpClient.setBass.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'treble',
      Characteristic: this.Characteristics.my.Treble,
      setter: this.zpClient.setTreble.bind(this.zpClient)
    })
    if (this.zpClient.balance) {
      this.addCharacteristicDelegate({
        key: 'balance',
        Characteristic: this.Characteristics.my.Balance,
        unit: '%',
        setter: this.zpClient.setBalance.bind(this.zpClient)
      })
    }
    if (this.zpClient.tvIn) {
      this.addCharacteristicDelegate({
        key: 'nightSound',
        Characteristic: this.Characteristics.my.NightSound,
        setter: this.zpClient.setNightSound.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'speechEnhancement',
        Characteristic: this.Characteristics.my.SpeechEnhancement,
        setter: this.zpClient.setSpeechEnhancement.bind(this.zpClient)
      })
    }
    if (/\(.*LS\+RS.*\)/.test(this.zpClient.zoneDisplayName)) {
      this.addCharacteristicDelegate({
        key: 'surroundEnabled',
        Characteristic: this.Characteristics.my.SurroundEnabled,
        setter: this.zpClient.setSurroundEnable.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'tvLevel',
        Characteristic: this.Characteristics.my.TvLevel,
        setter: this.zpClient.setTvLevel.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'musicLevel',
        Characteristic: this.Characteristics.my.MusicLevel,
        setter: this.zpClient.setMusicLevel.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'musicPlaybackFull',
        Characteristic: this.Characteristics.my.MusicPlaybackFull,
        setter: this.zpClient.setMusicPlaybackFull.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'heightLevel',
        Characteristic: this.Characteristics.my.HeightLevel,
        setter: this.zpClient.setHeightLevel.bind(this.zpClient)
      })
    }
    if (/\(.*Sub.*\)/.test(this.zpClient.zoneDisplayName)) {
      this.addCharacteristicDelegate({
        key: 'subEnabled',
        Characteristic: this.Characteristics.my.SubEnabled,
        setter: this.zpClient.setSubEnable.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'subLevel',
        Characteristic: this.Characteristics.my.SubLevel,
        setter: this.zpClient.setSubLevel.bind(this.zpClient)
      })
    }

    this.emit('initialised')

    zpAccessory.once('initialised', async () => {
      try {
        await this.zpClient.subscribe('/MediaRenderer/RenderingControl/Event')
      } catch (error) {
        this.error(error)
      }
    })
  }

  handleMediaRendererRenderingControlEvent (message) {
    if (
      message.lastChange == null ||
      !Array.isArray(message.lastChange) ||
      message.lastChange[0] == null
    ) {
      return
    }
    const event = message.lastChange[0]
    if (event.volume != null && event.volume.master != null) {
      this.values.volume = event.volume.master
      if (
        this.zpClient.balance &&
        event.volume.lf != null && event.volume.rf != null
      ) {
        this.values.balance = event.volume.rf - event.volume.lf
      }
    }
    if (event.mute != null && event.mute.master != null) {
      this.values.mute = !!event.mute.master
    }
    if (event.loudness != null && event.loudness.master != null) {
      this.values.loudness = !!event.loudness.master
    }
    if (event.bass != null) {
      this.values.bass = event.bass
    }
    if (event.treble != null) {
      this.values.treble = event.treble
    }
    if (event.nightMode != null) {
      this.values.nightSound = !!event.nightMode
    }
    if (event.dialogLevel != null) {
      this.values.speechEnhancement = !!event.dialogLevel
    }
    if (event.surroundEnabled != null) {
      this.values.surroundEnabled = !!event.surroundEnabled
    }
    if (event.surroundLevel != null) {
      this.values.tvLevel = event.surroundLevel
    }
    if (event.musicSurroundLevel != null) {
      this.values.musicLevel = event.musicSurroundLevel
    }
    if (event.surroundMode != null) {
      this.values.musicPlaybackFull = !!event.surroundMode
    }
    if (event.heightChannelLevel != null) {
      this.values.heightLevel = event.heightChannelLevel
    }
    if (event.subEnabled != null) {
      this.values.subEnabled = !!event.subEnabled
    }
    if (event.subGain != null) {
      this.values.subLevel = event.subGain
    }
  }
}

ZpService.Speaker = Speaker
