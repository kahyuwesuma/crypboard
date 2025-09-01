const loginBtn = document.getElementById('loginBtn');
const statusEl = document.getElementById('status');

// cek token
(async () => {
    const result = await window.authAPI.sessionCheck();
    if (result.success) {
        window.success.navigate("dashboard")
    }
})();

// login handler
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
    setTimeout(()=>{
        if (result.success) {
            statusEl.textContent = 'Login successfull';
            statusEl.style.color = 'green';
            setTimeout(()=>{
                window.success.navigate("dashboard");
            },1000)

        } else {
            statusEl.textContent = result.message;
            statusEl.style.color = 'red';
        }
    }, 1000)
});


function showCustomAlert(title, message, onConfirm) {
    const existing = document.querySelector(".custom-auth-alert");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "custom-auth-alert";
    wrapper.innerHTML = `
      <div class="custom-auth-alert-content">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="custom-auth-alert-buttons">
          <button class="primary" id="okBtn">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    // tombol event
    document.getElementById("okBtn").onclick = () => {
        wrapper.remove();
        if (onConfirm) onConfirm();
    };
}

