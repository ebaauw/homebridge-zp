// homebridge-zp/lib/ZpClient.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const events = require('events')
const request = require('request')
const ZpXmlParser = require('./ZpXmlParser')

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
  }

  async parse (xml) {
    if (this.parser == null) {
      this.parser = new ZpXmlParser()
    }
    return this.parser.parse(xml)
  }

  async open (zpListener) {
    this._debug('open()')
    this._callbackUrl = await zpListener.addClient(this)
    const description = await this.deviceDescription()
    const deviceList = [description.device].concat(description.device.deviceList)
    for (const device of deviceList) {
      for (const service of device.serviceList) {
        try {
          await this.subscribe(service.eventSubUrl)
        } catch (error) {
          this.emit('error', 'cannot subscribe to ' + service.eventSubUrl + ': ' + error.message)
        }
      }
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

  async subscribe (url, sid) {
    const callbackUrl = this._callbackUrl + url
    this._debug('subscribe(%j, %j)', url, sid || callbackUrl)
    const requestObj = {
      url: url,
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
    this._subscriptions[url] = response.headers.sid
    setTimeout(() => {
      this.subscribe(url, response.headers.sid)
    }, (this._subscriptionTimeout - 30) * 1000)
    this._debug(
      'subscribe(%j, %j) => %s', url, sid || callbackUrl,
      response.headers.sid
    )
  }

  async unsubscribe (url, sid) {
    this._debug('unsubscribe(%j, %j)', url, sid)
    const requestObj = {
      url: url,
      method: 'UNSUBSCRIBE',
      headers: {
        SID: sid
      }
    }
    const response = await this._request(requestObj)
    delete this._subscriptions[url]
    this._debug('unsubscribe(%j, %j) => %j', url, sid, response)
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
