export class MockAuthService {
  isAdmin() { return true; }
  isLoggedIn() { return true; }
  currentUser() { return { username: 'test_admin', rol: 'admin' }; }
  logout() {}
}