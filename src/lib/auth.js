// JWT 认证工具
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  console.warn('JWT_SECRET 未配置，当前仅适合本地开发');
}

const signingSecret = JWT_SECRET || 'development_only_secret_change_me';

function generateToken(payload) {
  return jwt.sign(payload, signingSecret, { expiresIn: '24h' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, signingSecret);
  } catch {
    return null;
  }
}

function getTokenFromRequest(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.match(/token=([^;]+)/);
  return match ? match[1] : null;
}

function requireAuth(request, allowedRoles = []) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const user = verifyToken(token);
  if (!user) return null;
  if (allowedRoles.length && !allowedRoles.includes(user.role)) return null;
  return user;
}

module.exports = { generateToken, verifyToken, getTokenFromRequest, requireAuth };
