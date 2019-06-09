// homebridge-zp/lib/ZpClient.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const events = require('events')
// const he = require('he')
const http = require('http')
// const homebridgeLib = require('homebridge-lib')
const os = require('os')
const request = require('request')
const XmlParser = require('./XmlParser')

let zpListener

class ZpListener {
  // Convert string with IP address to int.
  static ipToInt (ipaddress) {
    const a = ipaddress.split('.')
    return a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3]
  }

  // Check whether ip1 and ip2 are in the same network.
  static inSameNetwork (ip1, ip2, netmask) {
    return (ZpListener.ipToInt(ip1) & ZpListener.ipToInt(netmask)) ===
           (ZpListener.ipToInt(ip2) & ZpListener.ipToInt(netmask))
  }

  // Find my address for network of ip.
  static findMyAddressFor (ip) {
    const interfaces = os.networkInterfaces()
    for (const id in interfaces) {
      const aliases = interfaces[id]
      for (const aid in aliases) {
        const alias = aliases[aid]
        if (
          alias.family === 'IPv4' && alias.internal === false &&
          ZpListener.inSameNetwork(ip, alias.address, alias.netmask)
        ) {
          return alias.address
        }
      }
    }
    return '0.0.0.0'
  }

  constructor (ip) {
    this._debug = debug('ZpClient')
    this._debug('constructor(%j)', ip)
    this._host = ZpListener.findMyAddressFor(ip)
    this._clients = {}
    this._parser = new XmlParser()
    this._server = http.createServer((request, response) => {
      let buffer = ''
      request.on('data', (data) => {
        buffer += data
      })
      request.on('end', async () => {
        request.body = buffer
        this._debug('%s %s', request.method, request.url)
        if (request.method === 'GET' && request.url === '/notify') {
          // Provide an easy way to check that listener is reachable.
          response.writeHead(200, { 'Content-Type': 'text/plain' })
          response.write(this.infoMessage) // TODO
        } else if (request.method === 'NOTIFY') {
          const array = request.url.split('/')
          const client = this._clients[array[2]]
          const service = array[4] != null ? array[4] : array[3]
          if (array[1] === 'notify' && client !== null && service !== null) {
            const json = await this._parser.parse(request.body)
            client.emit(service + 'Event', json)
          }
        }
        response.end()
      })
    })
  }

  async callbackUrl () {
    return new Promise((resolve, reject) => {
      if (this._callbackUrl != null) {
        resolve(this._callbackUrl)
      }
      this._debug('callbackUrl()')
      this._server.listen(0, this._host, () => {
        this._callbackUrl = 'http://' + this._server.address().address + ':' +
                            this._server.address().port + '/notify'
        this._debug('callbackUrl() => %j', this._callbackUrl)
        return resolve(this._callbackUrl)
      })
    })
  }

  addClient (id, client) {
    this._clients[id] = client
  }
}

let id = 0

class ZpClient extends events.EventEmitter {
  // Note that Sonos zoneplayer only accept HTTP requests to the IP address.
  // A request to the hostname results in an Error 400: Bad request.
  constructor (options) {
    super()
    this._id = id++
    this._debug = debug('ZpClient' + this._id)
    this._debug('constructor(%j)', options)
    this._subscriptions = {}
    this._ipAddress = options.ipAddress
    this._baseUrl = 'http://' + this._ipAddress + ':1400'
    this._subscriptionTimeout = 30 * 60
    this._timeout = options.timeout * 1000
    this.zpListener.addClient(this._id, this)
  }

  emit (event, json) {
    this._debug('%s: %j', event, json)
    super.emit(event, json)
  }

  get zpListener () {
    if (zpListener == null) {
      zpListener = new ZpListener(this._ipAddress)
    }
    return zpListener
  }

  async parse (xml) {
    if (this.parser == null) {
      this.parser = new XmlParser()
    }
    return this.parser.parse(xml)
  }

  async open () {
    this._debug('open()')
    for (const service of ['DeviceProperties', 'ZoneGroupTopology', 'SystemProperties']) {
      await this.subscribe(service)
    }
    this._debug('open() => OK')
  }

  async close () {
    for (const service in this._subscriptions) {
      await this.unsubscribe(service, this._subscriptions[service])
    }
  }

  async _post (service, request, args) {

  }

  async subscribe (service, sid) {
    const callbackUrl = await this.zpListener.callbackUrl() +
                        '/' + this._id + '/' + service
    this._debug('subscribe(%j, %j)', service, sid || callbackUrl)
    const requestObj = {
      url: '/' + service + '/Event',
      method: 'SUBSCRIBE',
      headers: {
        TIMEOUT: 'Second-' + this._subscriptionTimeout
      }
    }
    if (sid == null) {
      requestObj.headers.CALLBACK = '<' + callbackUrl + '>'
      requestObj.headers.NT = 'upnp:event'
    } else {
      requestObj.headers.SID = sid
    }
    const response = await this._request(requestObj)
    this._debug('response: %j', response)
    this._subscriptions[service] = response.headers.sid
    setTimeout(() => {
      this.subscribe(service, response.headers.sid)
    }, (this._subscriptionTimeout - 30) * 1000)
    this._debug(
      'subscribe(%j, %j) => %s', service, sid || callbackUrl,
      response.headers.sid
    )
  }

  async unsubscribe (service, sid) {
    this._debug('unsubscribe(%j, %j)', service, sid)
    const requestObj = {
      url: '/' + service + '/Event',
      method: 'UNSUBSCRIBE',
      headers: {
        SID: sid
      }
    }
    const response = await this._request(requestObj)
    delete this._subscriptions[service]
    this._debug('unsubscribe(%j, %j) => %j', service, sid, response)
  }

  async deviceDescription (url = '/xml/device_description.xml') {
    const requestObj = {
      url: url,
      timeout: this.timeout
    }
    const response = await this._request(requestObj)
    return this.parse(response.body)
  }

  async _request (requestObj) {
    return new Promise((resolve, reject) => {
      this._debug('%s %s', requestObj.method || 'GET', requestObj.url)
      requestObj.baseUrl = this._baseUrl
      request(requestObj, (error, response) => {
        if (error) {
          return reject(error)
        }
        if (response.statusCode !== 200) {
          const msg = 'HTTP status ' + response.statusCode + ': ' + response.statusMessage
          return reject(new Error(msg))
        }
        this._debug('%s %s => OK', requestObj.method || 'GET', requestObj.url)
        return resolve(response)
      })
    })
  }
}

module.exports = ZpClient
