// ********************** Initialize server **********************************
const  app  = require('../src/index.js'); // <-- import the Express app

// ********************** Import Libraries ***********************************
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const { assert, expect } = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************
describe('Server!', () => {
  it('Returns the default welcome message', done => {
    chai
      .request(app)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equal('success');
        assert.strictEqual(res.body.message, 'Welcome!');
        done();
      });
  });
});

// *********************** Register API Tests **************************
describe('Testing Register API', () => {
  const randomUser = `test_user_${Date.now()}`;  

  it('positive : /register takes a new user and redirects to /login', done => {
    chai
      .request(app)
      .post('/register')
      .send({ username: randomUser, password: 'testPassword1' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res).to.redirectTo(/\/login$/);
        done();
      });
  });

  it('Negative : fail to register with invalid input', done => {
    chai
      .request(app)
      .post('/register')
      .send({ username: '', password: 123 })
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body).to.have.property('message', 'Invalid input');
        done();
      });
  });
});

// *********************** Redirect Tests **************************
describe('Testing Redirect', () => {
  it('test route should redirect to /login with 302 HTTP status code', done => {
    chai
      .request(app)
      .get('/test')
      .redirects(0)
      .end((err, res) => {
        expect(res).to.have.status(302);
        expect(res.header.location).to.equal('/login');
        done();
      });
  });
});

// *********************** Render Tests **************************
describe('Testing Render', () => {
  it('"/login" route should render with HTML response', done => {
    chai
      .request(app)
      .get('/login')
      .end((err, res) => {
        res.should.have.status(200);
        res.should.be.html;
        done();
      });
  });
});

// *********************** Logout Tests **************************
describe('Logout Route Tests', () => {
  let agent;

  beforeEach(() => {
    agent = chai.request.agent(app);
  });

  it('positive: /logout logs out an authenticated user', async () => {
    const username = `_logoutTest${Date.now()}`;
    await agent.post('/register').send({ username, password: 'testPass' });
    await agent.post('/login').send({ username, password: 'testPass' });

    const res = await agent.get('/logout');

    expect(res).to.have.status(200);
    expect(res.text).to.include('Logged out successfully');

    agent.close();
  });
});

// *********************** Logout Negative Test **************************
describe('Logout Route Tests - Negative', () => {
  it('negative: /logout redirects to /login when not authenticated', done => {
    chai
      .request(app)
      .get('/logout')
      .redirects(0)
      .end((err, res) => {
        expect(res).to.have.status(302);
        expect(res.header.location).to.equal('/login');
        done();
      });
  });
});
