#!/usr/bin/env node

// homebridge-zp/cli/zpinfo.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

// TODO: implement commands like `ph`
//
// zp [-hVn] [-t timeout] -H hostname command [argument ...]
//   discover [-v]
//   description [-s]
//   eventlog [-dn] [DeviceService ...]
//   play [...]
//   pause
//   stop
//   join [zone]
//   leave
//   volume [volume]
//   mute [true|false]
//   bass [bass]
//   treble [treble]
//   loudness [true|false]
//   balance [balance]
//   nightSound [true|false]
//   speechEnhancement [true|false]
//   led [true|false]
//   locked [true|false]

'use strict'

const chalk = require('chalk')
const homebridgeLib = require('homebridge-lib')
const ZpClient = require('../lib/ZpClient')
const ZpListener = require('../lib/ZpListener')
const packageJson = require('../package.json')

const b = chalk.bold
const u = chalk.underline
const usage = `${b('zpinfo')} [${b('-hVdnSs')}] [${b('-t')} ${u('timeout')}] ${u('hostname')} ...`
const help = `Sonos ZonePlayer information.

Print the device description of a Sonos ZonePlayer as JSON.
When run as daemon or service, log Sonos ZonePlayer events as JSON.

Usage: ${usage}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-d')}, ${b('--daemon')}
  Run as daemon.  Log ZonePlayer events.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-S')}, ${b('--scdp')}
  Include service control point definitions in device description.

  ${b('-s')}, ${b('--service')}
  Run as service.  Log ZonePlayer events, without timestamps.

  ${b('-t')} ${u('timeout')}, ${b('--timeout=')}${u('timeout')}
  Wait for ${u('timeout')} seconds instead of default ${b('15')}.

  ${u('hostname')}
  Hostname or IPv4 address of the zoneplayer.`

const unsupportedServices = [
  'ConnectionManager', // No useful information.
  'ContentDirectory', // Not supported by homebridge-zp.
  'MusicServices', // Not supported by homebridge-zp.
  'QPlay', // Doesn't support SUBSCRIBE.
  'Queue', // Not supported by homebridge-zp.
  'SystemProperties' // No useful information.
]

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super()
    this.usage = usage
    this.options = {
      noWhiteSpace: false,
      timeout: 5
    }
    this.clients = []
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', help)
    parser.version('V', 'version')
    parser.flag('d', 'daemon', () => { this.options.mode = 'daemon' })
    parser.flag('n', 'noWhiteSpace', () => { this.options.noWhiteSpace = true })
    parser.flag('S', 'scdp', () => { this.options.scdp = true })
    parser.flag('s', 'service', (key) => { this.options.mode = 'service' })
    parser.option('t', 'timeout', (value, key) => {
      this.options.timeout = homebridgeLib.OptionParser.toInt(value, 1, 60, true)
    })
    parser.parameter('hostname', (value) => { this.options.hostnames = [value] })
    parser.remaining((value) => {
      this.options.hostnames = this.options.hostnames.concat(value)
    })
    parser.parse()
  }

  async shutdown (signal) {
    this.log('Got %s, shutting down', signal)
    for (const zpClient of this.clients) {
      try {
        await zpClient.close()
      } catch (error) {
        this.error(error)
      }
    }
    setImmediate(() => { process.exit(0) })
  }

  async main () {
    try {
      this.parseArguments()

      const jsonOptions = { noWhiteSpace: this.options.noWhiteSpace }
      const jsonFormatter = new homebridgeLib.JsonFormatter(jsonOptions)

      if (this.options.mode != null) {
        this.setOptions({ mode: this.options.mode })
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
      }

      for (const hostname of this.options.hostnames) {
        try {
          const zpClient = new ZpClient({
            hostname: hostname,
            timeout: this.options.timeout
          })
          zpClient.on('error', (error) => {
            this.error('%s: %s', hostname, error.message)
          })
          zpClient.on('event', (device, service, event) => {
            // this.log('%s: %s %s event', hostname, device, service)
            this.log(
              '%s: %s %s event: %s', hostname,
              device, service, jsonFormatter.format(event)
            )
          })
          await zpClient.init()
          this.clients.push(zpClient)
          const description = await zpClient.get()
          if (this.options.mode) {
            await zpClient.open(this.zpListener)
            const deviceList = [description.device]
              .concat(description.device.deviceList)
            for (const device of deviceList) {
              for (const service of device.serviceList) {
                const serviceName = service.serviceId.split(':')[3]
                if (unsupportedServices.includes(serviceName)) {
                  continue
                }
                try {
                  await zpClient.subscribe(service.eventSubUrl)
                } catch (error) {
                  this.error(error)
                }
              }
            }
          } else {
            if (this.options.scdp) {
              const devices = [description.device]
                .concat(description.device.deviceList)
              for (const device of devices) {
                for (const service of device.serviceList) {
                  service.scpd = await zpClient.get(service.scpdUrl)
                }
              }
            }
            this.print(jsonFormatter.format(description))
            // this.print('zoneAttributes: %s', jsonFormatter.format(await zpClient.getZoneAttributes()))
            // this.print('zoneInfo: %s', jsonFormatter.format(await zpClient.getZoneInfo()))
            // this.print('zoneGroupAttributes: %s', jsonFormatter.format(await zpClient.getZoneGroupAttributes()))
            // this.print('zoneGroupState: %s', jsonFormatter.format(await zpClient.getZoneGroupState()))
            // this.print('alarms: %s', jsonFormatter.format(await zpClient.listAlarms()))
            // this.print(
            //   '%s: %s (%s) %s%s', hostname, zpClient.modelName,
            //   zpClient.modelNumber, zpClient.zoneName,
            //   zpClient.channel == null ? '' : ' [' + zpClient.channel + ']'
            // )
            // if (zpClient.type !== 'sattellite') {
            //   this.print('  volume: %s', jsonFormatter.format(await zpClient.getVolume()))
            //   this.print('  mute: %s', jsonFormatter.format(await zpClient.getMute()))
            //   this.print('  bass: %s', jsonFormatter.format(await zpClient.getBass()))
            //   this.print('  treble: %s', jsonFormatter.format(await zpClient.getTreble()))
            //   this.print('  loudness: %s', jsonFormatter.format(await zpClient.getLoudness()))
            // }
            // if (zpClient.balance) {
            //   this.print('  balance: %s', jsonFormatter.format(await zpClient.getBalance()))
            // }
            // if (zpClient.tvIn) {
            //   this.print('  night sound: %s', jsonFormatter.format(await zpClient.getNightSound()))
            //   this.print('  speech enhancement: %s', jsonFormatter.format(await zpClient.getSpeechEnhancement()))
            // }
            // this.print('  led: %s', jsonFormatter.format(await zpClient.getLedState()))
            // this.print('  locked: %s', jsonFormatter.format(await zpClient.getButtonLockState()))
            // this.print()
          }
        } catch (error) {
          this.error('%s: %s', hostname, error.message)
        }
      }
    } catch (error) {
      this.fatal(error)
    }
  }
}

new Main().main()
