const { ipcMain } = require('electron');
const Store = require('electron-store');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY

// Satu instance store global
const store = new Store();

function createToken(user) {
    const payload = {
        username: user.username,
        name: user.name
    };
    const token = jwt.sign(payload, SECRET_KEY, { expiresIn: TOKEN_EXPIRY });
    store.set('authToken', token);
    return token;
}

function verifyToken(token) {
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch (err) {
        return null;
    }
}

function withAuth(handler) {
    return async (event, ...args) => {
        const token = store.get('authToken');
        console.log(token)
        const decoded = verifyToken(token);
        if (!decoded) {
            return { success: false, message: 'Unauthorized or token expired' };
        }
        return handler(event, decoded, ...args);
    };
}

function tokenCheck(){
    const token = store.get('authToken');
    const decoded = verifyToken(token);
    if (!decoded) {
        return { success: false, message: 'Unauthorized or token expired' }
    }
    return { success: true };
}

ipcMain.handle('secure-action', withAuth(async (event, user, data) => {
    return { success: true, message: `This is secure for ${user.name}`, data };
}));

function clearToken() {
    store.delete('authToken');
    return true;
}

module.exports = { createToken, tokenCheck, clearToken };
