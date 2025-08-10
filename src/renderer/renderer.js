document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const status = document.getElementById('status');

  status.textContent = "Processing...";

  const result = await window.electronAPI.login(email, password);

  if (result.success) {
    status.style.color = "green";
    status.textContent = "Login Success!";
    console.log("User:", result.user);
    console.log("Session:", result.session);
  } else {
    status.style.color = "red";
    status.textContent = result.message;
  }
});
