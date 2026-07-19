const statusEl = document.getElementById('status');
fetch('http://127.0.0.1:3000/api/data/extension')
  .then(res => res.json())
  .then(data => {
    if (data.profile && data.profile.fullName) {
      let d = {};
      try { d = typeof data.profile.demographics === 'string' ? JSON.parse(data.profile.demographics) : data.profile.demographics || {}; } catch(e) {}
      const demoCount = Object.values(d).filter(v => v && v.length > 0).length;
      statusEl.innerHTML = '<b style="color:#3ecf8e">\u2705 Connected</b><br>' +
        'Profile: ' + data.profile.fullName + '<br>' +
        'Email: ' + (data.profile.email || 'not set') + '<br>' +
        'Demographics filled: ' + demoCount + '/28<br>' +
        '<span style="color:#999;font-size:11px">Click \u26A1 on any job page to autofill</span>';
    } else {
      statusEl.innerHTML = '<b style="color:#f59e0b">\u26A0\uFE0F Connected but profile empty</b><br>' +
        'Go to <a href="http://localhost:3000" target="_blank" style="color:#6d8bff">localhost:3000</a><br>' +
        'Fill & save your profile first.';
    }
  })
  .catch(() => {
    statusEl.innerHTML = '<b style="color:#ff4d4f">\u274C Cannot reach server</b><br>' +
      'Run <code>start-jobflow.bat</code><br>or <code>npm start</code> in the project folder.';
  });
