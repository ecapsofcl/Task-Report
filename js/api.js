async function apiCall(payload) {
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
  return res.json();
}

const Api = {
  login: function(username, password) { return apiCall({ action: 'login', username: username, password: password }); },
  changePassword: function(token, oldPassword, newPassword) { return apiCall({ action: 'changePassword', token: token, oldPassword: oldPassword, newPassword: newPassword }); },
  listUsers: function(token) { return apiCall({ action: 'listUsers', token: token }); },
  createUser: function(token, username, fullName, initialPassword, role) { return apiCall({ action: 'createUser', token: token, username: username, fullName: fullName, initialPassword: initialPassword, role: role }); },
  resetPassword: function(token, targetUsername, newPassword) { return apiCall({ action: 'resetPassword', token: token, targetUsername: targetUsername, newPassword: newPassword }); },
  setUserStatus: function(token, targetUsername, active) { return apiCall({ action: 'setUserStatus', token: token, targetUsername: targetUsername, active: active }); },
  listAvailableMonths: function(token, targetUsername) { return apiCall({ action: 'listAvailableMonths', token: token, targetUsername: targetUsername }); },
  listTasks: function(token, targetUsername, monthYear) { return apiCall({ action: 'listTasks', token: token, targetUsername: targetUsername, monthYear: monthYear }); },
  addTask: function(token, targetUsername, monthYear, task) { return apiCall({ action: 'addTask', token: token, targetUsername: targetUsername, monthYear: monthYear, task: task }); },
  updateTask: function(token, targetUsername, monthYear, sNo, updates) { return apiCall({ action: 'updateTask', token: token, targetUsername: targetUsername, monthYear: monthYear, sNo: sNo, updates: updates }); }
};
