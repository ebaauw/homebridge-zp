// homebridge-zp/lib/Nicercast.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.
//
// Shoutcast server.
// Adapted from https://github.com/stephen/nicercast.

const express = require('express')
const http = require('http')
const icecast = require('icecast-stack')
const lame = require('lame')
const stream = require('stream')

const encoderOptions = {
  channels: 2,
  bitDepth: 16,
  sampleRate: 44100
}

module.exports = class Nicercast {
  constructor (inputStream, options = {}) {
    this.inputStream = inputStream
    this.serverPort = false
    const app = express()
    this.app = app
    app.disable('x-powered-by')

    this.internalStream = new stream.PassThrough()
    this.inputStream.pipe(this.internalStream)

    // stream playlist (points to other endpoint)
    const playlistEndpoint = (req, res) => {
      res.status(200)
      res.set('Content-Type', 'audio/x-mpegurl')
      res.send('http://' + options.ipaddress + ':' + this.serverPort + '/AirTunes')
    }

    app.get('/', playlistEndpoint)
    app.get('/AirTunes.m3u', playlistEndpoint)

    // audio endpoint
    app.get('/AirTunes', (req, res, next) => {
      // generate response header
      const headers = {
        'Content-Type': 'audio/mpeg',
        Connection: 'close',
        'icy-metaint': 8192
      }
      res.writeHead(200, headers)

      // setup metadata transport
      res = new icecast.IcecastWriteStack(res, 8192)
      res.queueMetadata(this.metadata || options.name)

      // setup encoder
      const encoder = new lame.Encoder(encoderOptions)
      let prevMetadata = 0
      encoder.on('data', (chunk) => {
        if (prevMetadata !== this.metadata) {
          res.queueMetadata(this.metadata || options.name)
          prevMetadata = this.metadata
        }
        res.write(chunk)
      })

      const callback = (chunk) => {
        encoder.write(chunk)
      }

      this.internalStream.on('data', callback)
      req.connection.on('close', () => {
        encoder.end()
        this.internalStream.removeListener('data', callback)
      })
    })
  }

  start (port, callback) {
    this.serverPort = port !== null ? port : 0
    this.server = http.createServer(this.app).listen(this.serverPort, () => {
      this.serverPort = this.server.address().port

      if (callback && typeof callback === 'function') {
        callback(this.serverPort)
      }
    })
  }

  stop () {
    try {
      this.server.close()
    } catch (error) {
    }
  }

  setInputStream (inputStream) {
    this.inputStream.unpipe()
    this.inputStream = inputStream
    this.inputStream.pipe(this.internalStream)
  }

  setMetadata (metadata) {
    this.metadata = metadata
  }
}
