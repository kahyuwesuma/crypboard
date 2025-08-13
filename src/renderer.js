const loginBtn = document.getElementById('loginBtn');
const statusEl = document.getElementById('status');

loginBtn.addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        statusEl.textContent = 'Please fill in all fields.';
        statusEl.style.color = 'red';
        return;
    }

    statusEl.textContent = 'Processing...';
    statusEl.style.color = '#555';

    const result = await window.authAPI.login(username, password);

    if (result.success) {
        statusEl.textContent = result.message;
        statusEl.style.color = 'green';
        setTimeout(() => {
            // Nanti bisa redirect ke dashboard
        }, 1000);
    } else {
        statusEl.textContent = result.message;
        statusEl.style.color = 'red';
    }
});
