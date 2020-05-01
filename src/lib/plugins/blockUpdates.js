module.exports.server = (serv, { version }) => {
  const mcData = require('minecraft-data')(version)

  serv.MAX_UPDATES_PER_TICK = 10000

  // Each world has its own block update queue
  const worldUpdateQueue = new Map()

  // TODO: we could eliminate redundant block updates at this level
  // by checking if the update is already in the queue.

  serv.updateBlock = (world, pos, tick, forceNotify) => {
    // TODO: it would be better to know the list of loaded worlds at initialisation
    if (!worldUpdateQueue.has(world)) {
      worldUpdateQueue.set(world, [])
    }
    const updateQueue = worldUpdateQueue.get(world)
    updateQueue.push({ pos, tick, forceNotify })
  }

  serv.notifyNeighborsOfStateChange = (world, pos, tick, forceNotify) => {
    // TODO: it would be better to know the list of loaded worlds at initialisation
    if (!worldUpdateQueue.has(world)) {
      worldUpdateQueue.set(world, [])
    }
    const updateQueue = worldUpdateQueue.get(world)
    updateQueue.push({ pos: pos.offset(-1, 0, 0), tick, forceNotify }) // east
    updateQueue.push({ pos: pos.offset(1, 0, 0), tick, forceNotify }) // west
    updateQueue.push({ pos: pos.offset(0, -1, 0), tick, forceNotify }) // down
    updateQueue.push({ pos: pos.offset(0, 1, 0), tick, forceNotify }) // up
    updateQueue.push({ pos: pos.offset(0, 0, -1), tick, forceNotify }) // north
    updateQueue.push({ pos: pos.offset(0, 0, 1), tick, forceNotify }) // south
  }

  serv.notifyNeighborsOfStateChangeDirectional = (world, pos, dir, tick, forceNotify) => {
    // TODO: it would be better to know the list of loaded worlds at initialisation
    if (!worldUpdateQueue.has(world)) {
      worldUpdateQueue.set(world, [])
    }
    const updateQueue = worldUpdateQueue.get(world)
    const p = pos.plus(dir)
    updateQueue.push({ pos: p, tick, forceNotify }) // center
    if (dir.x !== 1) updateQueue.push({ pos: p.offset(-1, 0, 0), tick, forceNotify }) // east
    if (dir.x !== -1) updateQueue.push({ pos: p.offset(1, 0, 0), tick, forceNotify }) // west
    if (dir.y !== 1) updateQueue.push({ pos: p.offset(0, -1, 0), tick, forceNotify }) // down
    if (dir.y !== -1) updateQueue.push({ pos: p.offset(0, 1, 0), tick, forceNotify }) // up
    if (dir.z !== 1) updateQueue.push({ pos: p.offset(0, 0, -1), tick, forceNotify }) // north
    if (dir.z !== -1) updateQueue.push({ pos: p.offset(0, 0, 1), tick, forceNotify }) // south
  }

  const updateHandlers = new Map()
  /**
   * The handler is called when a block of the given type is
   * updated. The argument are world, block and tick.
   * It should return true if the block changed its state
   */
  serv.onBlockUpdate = (name, handler) => {
    updateHandlers.set(mcData.blocksByName[name].id, handler)
  }

  serv.on('tick', async (tickTime, curTick) => {
    for (const [world, updateQueue] of worldUpdateQueue.entries()) {
      let updatesCount = 0
      while (updatesCount < serv.MAX_UPDATES_PER_TICK && updateQueue.length > 0) {
        // TODO: use a binary heap to keep track of updates
        updateQueue.sort((a, b) => a.tick - b.tick)
        if (updateQueue[0].tick > curTick) break // We are done for this tick
        const { pos, tick, forceNotify } = updateQueue.shift()
        const block = await world.getBlock(pos)
        block.position = pos
        const handler = updateHandlers.get(block.type)
        if (handler) {
          const changed = await handler(world, block, tick)
          if (changed) {
            const block = await world.getBlock(pos)
            // TODO: build multi block update packet
            serv.players
              .filter(p => p.world === world)
              .forEach(player => player.sendBlock(pos, block.type, block.metadata))
          } else if (forceNotify) {
            serv.notifyNeighborsOfStateChange(world, pos, tick)
          }
        } else if (forceNotify) {
          serv.notifyNeighborsOfStateChange(world, pos, tick)
        }
        updatesCount++
      }

      if (updatesCount > 0) { console.log(`[Block Update] Made ${updatesCount} updates, ${updateQueue.length} remainings`) }
    }
  })
}
