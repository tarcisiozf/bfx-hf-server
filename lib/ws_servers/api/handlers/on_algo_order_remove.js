'use strict'

const { UserSettings: { _default: DEFAULT_SETTINGS } } = require('bfx-hf-ui-config')

const sendError = require('../../../util/ws/send_error')
const send = require('../../../util/ws/send')
const validateParams = require('../../../util/ws/validate_params')
const isAuthorized = require('../../../util/ws/is_authorized')
const { receiveOrder } = require('../../../util/ws/adapters')

module.exports = async (server, ws, msg) => {
  const { d, db, algoDB } = server
  const { UserSettings } = db
  const { AlgoOrder } = algoDB

  const [, authToken, orders] = msg

  const validRequest = validateParams(ws, {
    authToken: { type: 'string', v: authToken },
    orders: { type: 'array', v: orders }
  })

  const { userSettings } = await UserSettings.getAll()
  const { dms } = userSettings || DEFAULT_SETTINGS

  if (!validRequest) {
    d('invalid request: algo:remove')
    return
  }

  if (!isAuthorized(ws, authToken)) {
    return sendError(ws, 'Unauthorized')
  } else if (!ws.clients.bitfinex) {
    return sendError(ws, 'No client open for Bitfinex')
  }

  const bfxClient = ws.clients.bitfinex
  const removedOrders = []
  let activeOrders = []

  if (!dms) {
    const activeOrdersData = await bfxClient.rest.activeOrders()
    activeOrders = activeOrdersData.map(receiveOrder)
  }

  for (const algOrder of orders) {
    const { gid, algoID } = algOrder
    try {
      if (activeOrders.some(order => order.gid === +gid)) {
        await bfxClient.cancelOrdersByGid(+gid)
      }
      const updated = await AlgoOrder.update({ gid, algoID }, { active: false })
      if (updated) removedOrders.push(gid)
    } catch (err) {
      sendError(ws, `Error removing order: ${algoID} [${gid}]`)
      d('error removing order %s [%s]: %s', gid, algoID, err.stack)
    }
  }

  send(ws, ['algo.orders_removed', removedOrders])

  d('removed selected orders %s', JSON.stringify(removedOrders))
}
