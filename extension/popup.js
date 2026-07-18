const statusEl = document.getElementById('status');
fetch('http://127.0.0.1:3000/api/data/extension')
  .then(res => res.json())
  .then(data => {
    if (data.profile && data.profile.fullName) {
      statusEl.textContent = '✅ Connected: ' + data.profile.fullName;
      statusEl.className = 'status';
    } else {
      statusEl.textContent = '⚠️ Connected, but profile is empty.';
      statusEl.className = 'status err';
    }
  })
  .catch(e => {
    statusEl.textContent = '❌ JobFlow server not running on port 3000.';
    statusEl.className = 'status err';
  });
