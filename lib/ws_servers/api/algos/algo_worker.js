'use strict'

const debug = require('debug')
const d = debug('bfx:hf:server:algo-worker')

const { AOHost } = require('bfx-hf-algo')
const {
  PingPong, Iceberg, TWAP, AccumulateDistribute, MACrossover, OCOCO
} = require('bfx-hf-algo')
const algoOrders = [
  PingPong, Iceberg, TWAP, AccumulateDistribute, MACrossover, OCOCO
]

const validateAO = require('./util/validate_ao')

const CHANNEL_MSGS = 'hfpriv'

class AlgoWorker {
  constructor (settings, bcast) {
    this.host = null
    this.userID = null

    this.settings = settings
    this.algoOrders = algoOrders // fixme require via conf

    this.publish = bcast.redis ? redis.publish : bcast.ws
  }

  async start (apiKey, apiSecret, userID) {
    const { dms, affiliateCode, wsURL, restURL } = this.settings

    this.userID = userID

    d(
      'spawning bfx algo host (dms %s) [aff %s]',
      dms ? 'enabled' : 'disabled',
      affiliateCode
    )

    const wsSettings = {
      apiKey,
      apiSecret,
      dms: dms ? 4 : 0,
      withHeartbeat: true,
      affiliateCode,
      wsURL,
      restURL
    }

    const host = new AOHost({
      aos: this.algoOrders,
      wsSettings
    })

    this.host = host
    this.registerEvents()

    host.connect()
    d('spawned host for user %s', userID)

    console.log('----------------yeah!--------------')
  }

  pub () {

  }

  close () {
    this.host.removeAllListeners()
    this.host.close()
    this.host.cleanState()
  }

  registerEvents () {
    this.host.on('error', (error) => {
      console.log(error)

      this.pub([userID, ['error', `error: ${error}`]])
    })

    this.host.on('ao:start', (instance) => {
      const { state = {} } = instance
      const { name, label, args, gid } = state

      d('ao started: %s %s', name, label)
      this.pub([userID, ['started', userID, 'Bitfinex', name, label, gid, args]])
    })
  }

  async cancelOrder (userID, gid) {
    const { host } = this

    if (!host.getAOInstance(gid)) {
      throw new Error('Requested algo order not running, cannot stop')
    }

    await host.stopAO(gid)
    d('stopped AO for user %s on gid: %s', userID, gid)
  }

  async submitOrder (userID, aoID, order) {
    const { host } = this

    const validationError = validateAO(host, aoID, order)

    if (validationError) {
      throw new Error(validationError)
    }

    try {
      const gid = await host.startAO(aoID, order)
      d('started AO for user %s on [%s]', userID, gid)
    } catch (e) {
      d('error starting AO %s: %s', aoID, e)
      console.error(aoID, e.stack)
      throw new Error('Failed to start algo order')
    }
  }
}

module.exports = AlgoWorker