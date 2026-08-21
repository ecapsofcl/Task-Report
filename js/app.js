let state = { token: null, role: null, fullName: null, username: null };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function populateMonthYear(monthSelectId, yearSelectId) {
  const monthSelect = document.getElementById(monthSelectId);
  const yearSelect = document.getElementById(yearSelectId);
  monthSelect.innerHTML = MONTHS.map(function(m){ return '<option value="' + m + '">' + m + '</option>'; }).join('');
  const nowYear = new Date().getFullYear();
  let yearOptions = '';
  for (let y = nowYear - 2; y <= nowYear + 1; y++) {
    const yy = String(y).slice(-2);
    yearOptions += '<option value="' + yy + '">' + y + '</option>';
  }
  yearSelect.innerHTML = yearOptions;
  monthSelect.value = MONTHS[new Date().getMonth()];
  yearSelect.value = String(nowYear).slice(-2);
}

function currentMonthYearLabel(monthSelectId, yearSelectId) {
  return document.getElementById(monthSelectId).value + '-' + document.getElementById(yearSelectId).value;
}

function currentTargetUser(selectId) {
  return state.role === 'admin' ? document.getElementById(selectId).value : null;
}

async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const res = await Api.login(username, password);
  if (!res.success) {
    document.getElementById('loginError').innerText = res.error;
    return;
  }
  state = { token: res.token, role: res.role, fullName: res.fullName, username: username };
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('welcomeText').innerText = 'Hi, ' + res.fullName + (res.role === 'admin' ? ' (Admin)' : '');
  if (res.role === 'admin') {
    document.getElementById('adminNavBtn').classList.remove('hidden');
    document.getElementById('dashUserSelect').classList.remove('hidden');
    document.getElementById('taskUserSelect').classList.remove('hidden');
    await populateUserSelectors();
  }
  populateMonthYear('dashMonthSelect', 'dashYearSelect');
  populateMonthYear('taskMonthSelect', 'taskYearSelect');
  showView('dashboard');
  loadDashboard();
}

function logout() {
  state = { token: null };
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('loginPassword').value = '';
}

function showView(name) {
  ['dashboard', 'tasks', 'admin'].forEach(function(v){
    document.getElementById(v + 'View').classList.toggle('hidden', v !== name);
  });
  if (name === 'admin') loadUsers();
  if (name === 'tasks') loadTasks();
}

async function populateUserSelectors() {
  const res = await Api.listUsers(state.token);
  if (!res.success) return;
  const options = res.users.map(function(u){ return '<option value="' + u.username + '">' + u.fullName + '</option>'; }).join('');
  document.getElementById('dashUserSelect').innerHTML = options;
  document.getElementById('taskUserSelect').innerHTML = options;
}

let chartInstance = null;
async function loadDashboard() {
  const monthYear = currentMonthYearLabel('dashMonthSelect', 'dashYearSelect');
  const targetUsername = currentTargetUser('dashUserSelect');
  const res = await Api.listTasks(state.token, targetUsername, monthYear);
  if (!res.success) { alert(res.error); return; }

  const ctx = document.getElementById('statusChart').getContext('2d');
  const labels = Object.keys(res.stageCounts);
  const data = Object.values(res.stageCounts);
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: ['#e74c3c','#f39c12','#3498db','#9b59b6','#1abc9c','#2ecc71'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  const countsHtml = '<table><tr><th>Stage</th><th>Count</th></tr>' +
    labels.map(function(l, i){ return '<tr><td>' + l + '</td><td>' + data[i] + '</td></tr>'; }).join('') +
    '<tr><th>Total</th><th>' + data.reduce(function(a,b){ return a+b; }, 0) + '</th></tr></table>';
  document.getElementById('stageCountsTable').innerHTML = countsHtml;

  const overdue = res.tasks.filter(function(t){ return t.overdue; });
  document.getElementById('overdueBox').innerHTML = '<h3>Overdue Tasks (' + overdue.length + ')</h3>' +
    (overdue.length ? '<ul>' + overdue.map(function(t){ return '<li>' + t.task + ' (due ' + formatDate(t.dueDate) + ')</li>'; }).join('') + '</ul>' : '<p>None</p>');
}

async function loadTasks() {
  const monthYear = currentMonthYearLabel('taskMonthSelect', 'taskYearSelect');
  const targetUsername = currentTargetUser('taskUserSelect');
  const res = await Api.listTasks(state.token, targetUsername, monthYear);
  if (!res.success) { alert(res.error); return; }

  const tbody = document.querySelector('#tasksTable tbody');
  tbody.innerHTML = res.tasks.map(function(t){
    const rowClass = t.status === 'Completed' ? 'status-completed' : (t.overdue ? 'status-overdue' : '');
    return '<tr class="' + rowClass + '">' +
      '<td>' + t.sNo + '</td>' +
      '<td>' + formatDate(t.assignedDate) + '</td>' +
      '<td>' + t.task + '</td>' +
      '<td>' + t.priority + '</td>' +
      '<td>' + formatDate(t.dueDate) + '</td>' +
      '<td>' + statusDropdown(t.sNo, t.status) + '</td>' +
      '<td>' + (t.daysSinceUpdate !== null ? t.daysSinceUpdate + ' day(s)' : '-') + '</td>' +
      '<td>' + t.percent + '%</td>' +
      '</tr>';
  }).join('');
}

function statusDropdown(sNo, currentStatus) {
  const statuses = ['Not Started','Initial Discussion','In Progress','Execute','Review','Completed'];
  const opts = statuses.map(function(s){ return '<option value="' + s + '"' + (s === currentStatus ? ' selected' : '') + '>' + s + '</option>'; }).join('');
  return '<select onchange="submitStatusChange(' + sNo + ', this.value)">' + opts + '</select>';
}

async function submitStatusChange(sNo, newStatus) {
  const monthYear = currentMonthYearLabel('taskMonthSelect', 'taskYearSelect');
  const targetUsername = currentTargetUser('taskUserSelect');
  const res = await Api.updateTask(state.token, targetUsername, monthYear, sNo, { status: newStatus });
  if (!res.success) { alert(res.error); return; }
  loadTasks();
}

async function submitAddTask() {
  const monthYear = currentMonthYearLabel('taskMonthSelect', 'taskYearSelect');
  const targetUsername = currentTargetUser('taskUserSelect');
  const task = {
    task: document.getElementById('newTaskText').value,
    priority: document.getElementById('newTaskPriority').value,
    dueDate: document.getElementById('newTaskDueDate').value
  };
  if (!task.task) { alert('Please enter a task description'); return; }
  const res = await Api.addTask(state.token, targetUsername, monthYear, task);
  if (!res.success) { alert(res.error); return; }
  document.getElementById('newTaskText').value = '';
  document.getElementById('newTaskDueDate').value = '';
  loadTasks();
}

async function loadUsers() {
  const res = await Api.listUsers(state.token);
  if (!res.success) { alert(res.error); return; }
  const tbody = document.querySelector('#usersTable tbody');
  tbody.innerHTML = res.users.map(function(u){
    return '<tr><td>' + u.username + '</td><td>' + u.fullName + '</td><td>' + u.role + '</td><td>' + u.status + '</td>' +
    '<td>' +
      '<button onclick="promptResetPassword(\'' + u.username + '\')">Reset Password</button> ' +
      '<button onclick="toggleUserStatus(\'' + u.username + '\', ' + (u.status === 'active') + ')">' + (u.status === 'active' ? 'Deactivate' : 'Activate') + '</button>' +
    '</td></tr>';
  }).join('');
}

async function promptResetPassword(username) {
  const newPassword = prompt('Enter new password for ' + username + ':');
  if (!newPassword) return;
  const res = await Api.resetPassword(state.token, username, newPassword);
  alert(res.success ? 'Password reset successfully' : res.error);
}

async function toggleUserStatus(username, currentlyActive) {
  const res = await Api.setUserStatus(state.token, username, !currentlyActive);
  if (!res.success) { alert(res.error); return; }
  loadUsers();
}

async function submitCreateUser() {
  const username = document.getElementById('newUsername').value.trim();
  const fullName = document.getElementById('newFullName').value.trim();
  const initialPassword = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  if (!username || !fullName || !initialPassword) { alert('Please fill all fields'); return; }
  const res = await Api.createUser(state.token, username, fullName, initialPassword, role);
  if (!res.success) { alert(res.error); return; }
  alert('User created. Task sheet: ' + res.sheetUrl);
  document.getElementById('newUsername').value = '';
  document.getElementById('newFullName').value = '';
  document.getElementById('newUserPassword').value = '';
  loadUsers();
  populateUserSelectors();
}

function openChangePassword() { document.getElementById('changePasswordModal').classList.remove('hidden'); }
function closeChangePassword() {
  document.getElementById('changePasswordModal').classList.add('hidden');
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPassword').value = '';
}
async function submitChangePassword() {
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const res = await Api.changePassword(state.token, oldPassword, newPassword);
  alert(res.success ? 'Password updated' : res.error);
  if (res.success) closeChangePassword();
}

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return (date.getMonth()+1) + '/' + date.getDate() + '/' + date.getFullYear();
}
