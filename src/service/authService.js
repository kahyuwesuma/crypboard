const users = [
    { username: 'admin', password: '12345', name: 'Administrator' },
    { username: 'wahyu', password: 'password', name: 'Wahyu Kesuma' }
];

module.exports = {
    login: (username, password) => {
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            return { success: true, message: `Welcome, ${user.name}!` };
        } else {
            return { success: false, message: 'Invalid username or password.' };
        }
    }
};
