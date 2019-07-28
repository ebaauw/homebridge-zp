#!/usr/bin/env node

// homebridge-zp/cli/zp.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const chalk = require('chalk')
const homebridgeLib = require('homebridge-lib')
const ZpClient = require('../lib/ZpClient')
const ZpListener = require('../lib/ZpListener')
const packageJson = require('../package.json')

const b = chalk.bold
const u = chalk.underline

class UsageError extends Error {}

const usage = {
  zp: `${b('zp')} [${b('-hV')}] [${b('-H')} ${u('hostname')}[${b(':')}${u('port')}]] [${b('-t')} ${u('timeout')}] ${u('command')} [${u('argument')} ...]`,
  info: `${b('info')} [${b('-hn')}]`,
  description: `${b('description')} [${b('-hnSs')}]`,
  topology: `${b('topology')} [${b('-hnpv')}]`,
  eventlog: `${b('eventlog')} [${b('-hns')}]`,
  browse: `${b('browse')} [${b('-hn')}] [${u('object')}]`,
  play: `${b('play')} [${b('-h')}] [${u('uri')} [${u('meta')}]]`,
  queue: `${b('queue')} [${b('-h')}] ${u('uri')} [${u('meta')}]`,
  pause: `${b('pause')} [${b('-h')}]`,
  stop: `${b('stop')} [${b('-h')}]`,
  next: `${b('next')} [${b('-h')}]`,
  previous: `${b('previous')} [${b('-h')}]`,
  sleepTimer: `${b('sleepTimer')} [${b('-h')}] [${u('time')}|${b('off')}]`,
  groupVolume: `${b('groupVolume')} [${b('-h')}] [${u('volume')}]`,
  groupMute: `${b('groupMute')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  join: `${b('join')} [${b('-h')}] ${u('zone')}`,
  leave: `${b('leave')} [${b('-h')}]`,
  volume: `${b('volume')} [${b('-h')}] [${u('volume')}]`,
  mute: `${b('mute')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  bass: `${b('bass')} [${b('-h')}] [${b('--')}] [${u('bass')}]`,
  treble: `${b('treble')} [${b('-h')}] [${b('--')}] [${u('treble')}]`,
  loudness: `${b('loudness')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  balance: `${b('balance')} [${b('-h')}] [${b('--')}] [${u('balance')}]`,
  nightSound: `${b('nightSound')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  speechEnhancement: `${b('speechEnhancement')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  led: `${b('led')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  buttonLock: `${b('buttonLock')} [${b('-h')}] [${b('on')}|${b('off')}]`
}

const description = {
  zp: 'Command line interface to Sonos ZonePlayer.',
  info: 'Print zone player properties.',
  description: 'Print zone player device description.',
  topology: 'Print zones and zone players known by the zone player.',
  eventlog: 'Log zone player events.',
  browse: 'Browse media.',
  play: 'Play.',
  queue: 'Queue.',
  pause: 'Pause.',
  stop: 'Stop.',
  next: 'Go to next track.',
  previous: 'Go to previous track.',
  sleepTimer: 'Get/set/clear sleep timer.',
  groupVolume: 'Get/set group volume.',
  groupMute: 'Get/set/clear group mute.',
  join: 'Join ZoneGroup.',
  leave: 'Leave ZoneGroup.',
  volume: 'Get/set volume.',
  mute: 'Get/set/clear mute.',
  bass: 'Get/set bass.',
  treble: 'Get/set treble.',
  loudness: 'Get/set/clear loudness.',
  balance: 'Get/set balance.',
  nightSound: 'Get/set/clear nightsound.',
  speechEnhancement: 'Get/set/clear speech enhancement.',
  led: 'Get/set/clear LED state.',
  buttonLock: 'Get/set/clear button lock state.'
}

const help = {
  zp: `${description.zp}

Usage: ${usage.zp}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-H')} ${u('hostname')}[${b(':')}${u('port')}], ${b('--host=')}${u('hostname')}[${b(':')}${u('port')}]
  Connect to ZonePlayer at ${u('hostname')}${b(':1400')} or ${u('hostname')}${b(':')}${u('port')}.
  Default ZonePlayer can be set in the ${b('ZP_HOST')} environment variable.

  ${b('-t')} ${u('timeout')}, ${b('--timeout=')}${u('timeout')}
  Set timeout to ${u('timeout')} seconds instead of default ${b('5')}.

Commands:
  ${usage.info}
  ${description.info}

  ${usage.description}
  ${description.description}

  ${usage.topology}
  ${description.topology}

  ${usage.eventlog}
  ${description.eventlog}

  ${usage.browse}
  ${description.browse}

  ${usage.play}
  ${description.play}

  ${usage.queue}
  ${description.queue}

  ${usage.pause}
  ${description.pause}

  ${usage.stop}
  ${description.stop}

  ${usage.next}
  ${description.next}

  ${usage.previous}
  ${description.previous}

  ${usage.sleepTimer}
  ${description.sleepTimer}

  ${usage.groupVolume}
  ${description.groupVolume}

  ${usage.groupMute}
  ${description.groupMute}

  ${usage.join}
  ${description.join}

  ${usage.leave}
  ${description.leave}

  ${usage.volume}
  ${description.volume}

  ${usage.mute}
  ${description.mute}

  ${usage.bass}
  ${description.bass}

  ${usage.treble}
  ${description.treble}

  ${usage.loudness}
  ${description.loudness}

  ${usage.balance}
  ${description.balance}

  ${usage.nightSound}
  ${description.nightSound}

  ${usage.speechEnhancement}
  ${description.speechEnhancement}

  ${usage.led}
  ${description.led}

  ${usage.buttonLock}
  ${description.buttonLock}

For more help, issue: ${b('zp')} ${u('command')} ${b('-h')}`,
  info: `${description.info}

Usage: ${b('zp')} ${usage.info}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.`,
  description: `${description.description}

Usage: ${b('zp')} ${usage.description}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-S')}, ${b('--scpd')}
  Include service control point definitions.

  ${b('-s')}, ${b('--sortKeys')}
  Sort JSON object key/value pairs alphabetically on key.`,
  topology: `${description.topology}

Usage: ${b('zp')} ${usage.topology}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-p')}, ${b('--playersOnly')}
  Do not include zones in the output.

  ${b('-v')}, ${b('--verify')}
  Verify that each zone player can be reached.
  Include the device description information for reachable zone players.
  Unreachable zone player are omitted from the output.`,
  eventlog: `${description.eventlog}

Usage: ${b('zp')} ${usage.eventlog}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-s')}, ${b('--service')}
  Do not output timestamps (useful when running as service).`,
  browse: `${description.browse}
Returns a list of media items with ${u('object')} for browsing or ${u('uri')} for playing.

Usage: ${b('zp')} ${usage.browse}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${u('object')}
  Browse ${u('object')} instead of default (top level).
  Use ${b('zp browse')} to obtain the value for ${u('object')}.`,
  play: `${description.play}

Usage: ${b('zp')} ${usage.play}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('uri')}
  Set source to ${u('uri')}.
  Use ${b('zp browse')} to obtain the value for ${u('uri')}.

  ${u('meta')}
  Set meta data for source to ${u('meta')}.
  Use ${b('zp browse')} to obtain the value for ${u('meta')}.`,
  queue: `${description.queue}

Usage: ${b('zp')} ${usage.queue}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('uri')}
  Set source to ${u('uri')}.
  Use ${b('zp browse')} to obtain the value for ${u('uri')}.

  ${u('meta')}
  Set meta data for source to ${u('meta')}.
  Use ${b('zp browse')} to obtain the value for ${u('meta')}.`,
  pause: `${description.pause}

Usage: ${b('zp')} ${usage.pause}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  stop: `${description.stop}

Usage: ${b('zp')} ${usage.stop}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  next: `${description.next}

Usage: ${b('zp')} ${usage.stop}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  previous: `${description.previous}

Usage: ${b('zp')} ${usage.previous}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  sleepTimer: `${description.sleepTimer}

Usage: ${b('zp')} ${usage.sleepTimer}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('time')}
  Set sleep timer to ${u('time')} (from ${b('00:00:00')} to ${b('23:59:59')}).

  ${b('off')}
  Clear sleep timer.`,
  groupVolume: `${description.groupVolume}

Usage: ${b('zp')} ${usage.groupVolume}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('volume')}
  Set group volume to ${u('volume')} (from 0 to 100).`,
  groupMute: `${description.groupMute}

Usage: ${b('zp')} ${usage.groupMute}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set group mute.

  ${b('off')}
  Clear group mute.`,
  join: `${description.join}

Usage: ${b('zp')} ${usage.join}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('zone')}
  Join ${u('zone')}'s group.`,
  leave: `${description.leave}

Usage: ${b('zp')} ${usage.leave}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  volume: `${description.volume}

Usage: ${b('zp')} ${usage.volume}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('volume')}
  Set volume to ${u('volume')} (from 0 to 100).`,
  mute: `${description.mute}

Usage: ${b('zp')} ${usage.mute}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set mute.

  ${b('off')}
  Clear mute.`,
  bass: `${description.bass}

Usage: ${b('zp')} ${usage.bass}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('bass')}
  Set bass to ${u('bass')} (from -10 to 10).`,
  treble: `${description.treble}

Usage: ${b('zp')} ${usage.treble}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('treble')}
  Set treble to ${u('treble')}.`,
  loudness: `${description.loudness}

Usage: ${b('zp')} ${usage.loudness}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set loudness.

  ${b('off')}
  Clear loudness.`,
  balance: `${description.balance}

Usage: ${b('zp')} ${usage.balance}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('balance')}
  Set treble to ${u('balance')}.`,
  nightSound: `${description.nightSound}

Usage: ${b('zp')} ${usage.nightSound}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set night sound.

  ${b('off')}
  Clear night sound.`,
  speechEnhancement: `${description.speechEnhancement}

Usage: ${b('zp')} ${usage.speechEnhancement}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set speech enhancement.

  ${b('off')}
  Clear speech enhancement.`,
  led: `${description.led}

Usage: ${b('zp')} ${usage.led}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set ZonePlayer LED on.

  ${b('off')}
  Set ZonePlayer LED off.`,
  buttonLock: `${description.buttonLock}

Usage: ${b('zp')} ${usage.buttonLock}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set ZonePlayer button lock state (i.e. disable ZonePlayer buttons).

  ${b('off')}
  Clear ZonePlayer button lock state (i.e. enable ZonePlayer buttons).`
}

const unsupportedServices = [
  'ConnectionManager', // No useful information.
  // 'ContentDirectory', // Not supported by homebridge-zp.
  'MusicServices', // Not supported by homebridge-zp.
  'QPlay', // Doesn't support SUBSCRIBE.
  'Queue', // Not supported by homebridge-zp.
  'SystemProperties' // No useful information.
]

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super()
    this.usage = usage.zp
    this.clients = []
  }

  async main () {
    try {
      this._clargs = this.parseArguments()
      if (this._clargs.options.host == null || this._clargs.options.host === '') {
        throw new UsageError(`Missing host.  Set ${b('ZP_HOST')} or specify ${b('-H')}.`)
      }
      this.zpClient = new ZpClient(this._clargs.options)
      this.zpClient.on('error', (error) => { this.error(error) })
      await this.zpClient.init()
      this.name = 'zp ' + this._clargs.command
      this.usage = `${b('zp')} ${usage[this._clargs.command]}`
      this.help = help[this._clargs.command]
      await this[this._clargs.command](this._clargs.args)
    } catch (error) {
      this.error(error)
    }
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {
        host: process.env.ZP_HOST,
        timeout: 5
      }
    }
    parser.help('h', 'help', help.zp)
    parser.version('V', 'version')
    parser.option('H', 'host', (value) => {
      homebridgeLib.OptionParser.toHost(value, true)
      clargs.options.host = value
    })
    parser.option('t', 'timeout', (value) => {
      clargs.options.timeout = homebridgeLib.OptionParser.toInt(value, 1, 60, true)
    })
    parser.parameter('command', (value) => {
      if (usage[value] == null || typeof this[value] !== 'function') {
        throw new UsageError(`${value}: unknown command`)
      }
      clargs.command = value
    })
    parser.remaining((list) => { clargs.args = list })
    parser.parse()
    return clargs
  }

  async shutdown (signal) {
    this.log('Got %s, shutting down', signal)
    await this.zpClient.close()
    setImmediate(() => { process.exit(0) })
  }

  async info (...args) {
    const parser = new homebridgeLib.CommandLineParser()
    const clargs = {
      options: { sortKeys: true }
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    const json = jsonFormatter.stringify(this.zpClient.info)
    this.print(json)
  }

  async description (...args) {
    const parser = new homebridgeLib.CommandLineParser()
    const clargs = {
      options: {}
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('S', 'scdp', () => { clargs.scdp = true })
    parser.flag('s', 'sortKeys', () => { clargs.options.sortKeys = true })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    const response = await this.zpClient.get()
    if (clargs.scdp) {
      const devices = [response.device]
        .concat(response.device.deviceList)
      for (const device of devices) {
        for (const service of device.serviceList) {
          service.scpd = await this.zpClient.get(service.scpdUrl)
        }
      }
    }
    const json = jsonFormatter.stringify(response)
    this.print(json)
  }

  async topology (...args) {
    const parser = new homebridgeLib.CommandLineParser()
    const clargs = {
      options: { sortKeys: true }
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('p', 'playersOnly', () => { clargs.players = true })
    parser.flag('v', 'verify', () => { clargs.verify = true })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    let zonePlayers = {}
    let zones = {}
    if (clargs.verify) {
      zones = this.zpClient.zones
      const jobs = []
      for (const zoneName in zones) {
        const zone = zones[zoneName]
        for (const zonePlayerName in zone.zonePlayers) {
          const zonePlayer = zone.zonePlayers[zonePlayerName]
          const zpClient = new ZpClient({
            host: zonePlayer.address,
            id: zonePlayer.id,
            timeout: this._clargs.options.timeout
          })
          jobs.push(zpClient.init()
            .then(() => {
              zone.zonePlayers[zonePlayerName] = zpClient.info
              zonePlayers[zonePlayerName] = zpClient.info
            }).catch((error) => {
              delete zone.zonePlayers[zonePlayerName]
              this.error('%s: %s', zonePlayer.address, error.message)
            })
          )
        }
      }
      for (const job of jobs) {
        await job
      }
      for (const zoneName in zones) {
        if (Object.keys(zones[zoneName].zonePlayers).length === 0) {
          delete zones[zoneName]
        }
      }
    } else if (clargs.players) {
      zonePlayers = this.zpClient.zonePlayers
    } else {
      zones = this.zpClient.zones
    }
    const json = jsonFormatter.stringify(clargs.players ? zonePlayers : zones)
    this.print(json)
  }

  async eventlog (...args) {
    const parser = new homebridgeLib.CommandLineParser()
    const clargs = {
      mode: 'daemon',
      options: {}
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('s', 'service', () => { clargs.mode = 'service' })
    parser.parse(...args)
    this.setOptions({ mode: clargs.mode })
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    process.on('SIGINT', () => { this.shutdown('SIGINT') })
    process.on('SIGTERM', () => { this.shutdown('SIGTERM') })
    this.zpListener = new ZpListener()
    this.zpListener.on('listening', (url) => {
      this.log('listening on %s', url)
    })
    this.zpListener.on('close', (url) => {
      this.log('closed %s', url)
    })
    this.zpListener.on('error', (error) => { this.error(error) })
    this.zpClient.on('event', (device, service, event) => {
      this.log(
        '%s: %s %s event: %s', this.zpClient.name,
        device, service, jsonFormatter.format(event)
      )
    })
    await this.zpClient.open(this.zpListener)
    const description = await this.zpClient.get()
    const deviceList = [description.device].concat(description.device.deviceList)
    for (const device of deviceList) {
      for (const service of device.serviceList) {
        const serviceName = service.serviceId.split(':')[3]
        if (unsupportedServices.includes(serviceName)) {
          continue
        }
        try {
          await this.zpClient.subscribe(service.eventSubUrl)
        } catch (error) {
          this.error(error)
        }
      }
    }
  }

  async browse (...args) {
    const clargs = { options: {} }
    const parser = new homebridgeLib.CommandLineParser()
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      clargs.object = list[0]
    })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    let result
    if (clargs.object == null) {
      result = {
        'Music Library': { browse: 'A:' },
        'Music Library Servers': { browse: 'S:' },
        'Sonos Favorites': { browse: 'FV:' },
        'Sonos Playlists': { browse: 'SQ:' },
        'Sonos Queues': { browse: 'Q:' }
      }
      if (this.zpClient.airPlay) {
        result['AirPlay'] = {
          uri: 'x-sonosapi-vli:' + this.zpClient.id
        }
      }
      if (this.zpClient.audioIn) {
        result['Audio In'] = {
          uri: 'x-rincon-stream:' + this.zpClient.id
        }
      }
      if (this.zpClient.tvIn) {
        result['TV'] = {
          uri: 'x-sonos-htastream:' + this.zpClient.id + ':spdif'
        }
      }
    } else {
      result = await this.zpClient.browse(clargs.object)
    }
    const json = jsonFormatter.stringify(result)
    this.print(json)
  }

  async play (...args) {
    let uri
    let meta
    const parser = new homebridgeLib.CommandLineParser()
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 2) {
        throw new UsageError('too many arguments')
      }
      uri = list[0]
      meta = list[1]
    })
    parser.parse(...args)
    if (uri != null) {
      await this.zpClient.setAvTransportUri(uri, meta)
    }
    await this.zpClient.play()
  }

  async queue (...args) {
    let uri
    let meta
    const parser = new homebridgeLib.CommandLineParser()
    parser.help('h', 'help', this.help)
    parser.parameter('uri', (value) => {
      uri = value
    })
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      meta = list[0]
    })
    parser.parse(...args)
    await this.zpClient.setAvTransportQueue(uri, meta)
  }

  async pause (...args) { return this.simpleCommand('pause', ...args) }
  async stop (...args) { return this.simpleCommand('stop', ...args) }
  async next (...args) { return this.simpleCommand('next', ...args) }
  async previous (...args) { return this.simpleCommand('previous', ...args) }

  async sleepTimer (...args) {
    const parser = new homebridgeLib.CommandLineParser()
    let duration
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        if (/^(:?2[0-3]|[01][0-9]):[0-5][0-9]:[0-5][0-9]$/.test(list[0])) {
          duration = list[0]
        } else if (list[0] === 'off') {
          duration = ''
        } else {
          throw new UsageError(`${list[0]}: invalid duration`)
        }
      }
    })
    parser.parse(...args)
    if (duration != null) {
      await this.zpClient.setSleepTimer(duration)
    }
    const timer = await this.zpClient.getSleepTimer()
    this.print(timer === '' ? 'off' : timer)
  }

  async groupVolume (...args) { return this.valueCommand('GroupVolume', 0, 100, ...args) }
  async groupMute (...args) { return this.onOffCommand('GroupMute', ...args) }

  async join (...args) {
    let coordinator
    const parser = new homebridgeLib.CommandLineParser()
    parser.help('h', 'help', this.help)
    parser.parameter('zone', (value) => {
      coordinator = value
    })
    parser.parse(...args)
    const zones = this.zpClient.zones
    if (zones[coordinator] == null) {
      throw new Error(`${coordinator}: zone not found`)
    }
    const zone = zones[coordinator]
    const master = zone.zonePlayers[zone.master]
    return this.zpClient.setAvTransportUri('x-rincon:' + master.id)
  }

  async leave (...args) { return this.simpleCommand('becomeCoordinatorOfStandaloneGroup', ...args) }
  async volume (...args) { return this.valueCommand('Volume', 0, 100, ...args) }
  async mute (...args) { return this.onOffCommand('Mute', ...args) }
  async bass (...args) { return this.valueCommand('Bass', -10, 10, ...args) }
  async treble (...args) { return this.valueCommand('Treble', -10, 10, ...args) }
  async balance (...args) { return this.valueCommand('Balance', -100, 100, ...args) }
  async loudness (...args) { return this.onOffCommand('Loudness', ...args) }
  async nightSound (...args) { return this.onOffCommand('NightSound', ...args) }
  async speechEnhancement (...args) { return this.onOffCommand('SpeechEnhancement', ...args) }
  async led (...args) { return this.onOffCommand('LedState', ...args) }
  async buttonLock (...args) { return this.onOffCommand('ButtonLockState', ...args) }

  async simpleCommand (command, ...args) {
    const parser = new homebridgeLib.CommandLineParser()
    parser.help('h', 'help', this.help)
    parser.parse(...args)
    await this.zpClient[command]()
  }

  async valueCommand (command, min, max, ...args) {
    const parser = new homebridgeLib.CommandLineParser()
    let value
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        value = homebridgeLib.OptionParser.toInt(list[0], min, max, true)
      }
    })
    parser.parse(...args)
    if (value != null) {
      await this.zpClient['set' + command](value)
    }
    this.print(await this.zpClient['get' + command]())
  }

  async onOffCommand (command, ...args) {
    const parser = new homebridgeLib.CommandLineParser()
    let value
    if (args.length > 1) {
      throw new UsageError('too many arguments')
    }
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        value = homebridgeLib.OptionParser.toBool(list[0], true)
      }
    })
    parser.parse(...args)
    if (value != null) {
      await this.zpClient['set' + command](value)
    }
    this.print((await this.zpClient['get' + command]()) ? 'on' : 'off')
  }
}

new Main().main()
