const LEVEL = {
  OWNER: 100,   // bot owner (fixed, from setup wizard)
  GOWNER: 90,   // group owner (/owner)
  ADMIN: 80,    // bot-level admin (/admin)
  MANAGER: 70,  // real telegram admin via /promote
  VIP: 50,
  EXEMPT: 40,
  MEMBER: 0
};

function getRole(group, userId, botOwnerId) {
  userId = Number(userId);
  if (botOwnerId && userId === Number(botOwnerId)) return LEVEL.OWNER;
  if (group.owners.includes(userId)) return LEVEL.GOWNER;
  if (group.admins.includes(userId)) return LEVEL.ADMIN;
  if (group.managers.includes(userId)) return LEVEL.MANAGER;
  if (group.vips && group.vips[userId] !== undefined) return LEVEL.VIP;
  if (group.exempts.includes(userId)) return LEVEL.EXEMPT;
  return LEVEL.MEMBER;
}

function roleName(level) {
  return Object.keys(LEVEL).find((k) => LEVEL[k] === level) || 'MEMBER';
}

// can actorLevel act on targetLevel? Must be strictly higher, except OWNER can act on anyone.
function canAct(actorLevel, targetLevel) {
  if (actorLevel === LEVEL.OWNER) return true;
  return actorLevel > targetLevel;
}

module.exports = { LEVEL, getRole, roleName, canAct };
