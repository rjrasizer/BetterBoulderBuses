document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('registerForm');
  if (!form) {
    return;
  }

  const emailInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');

  const submitButton = document.getElementById('registerSubmit');

  const feedback = document.getElementById('passwordFeedback');
  const emailFeedback = document.getElementById('emailFeedback'); // NEW

  // ----------------------
  // REGEX RULES
  // ----------------------
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Must have: 8 chars, uppercase, lowercase, number, special char
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  // ----------------------
  // FORM VALIDATION
  // ----------------------
  const updateButtonState = () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    const passwordsMatch = password !== '' && password === confirmPassword;
    const validEmail = emailRegex.test(email);
    const validPassword = passwordRegex.test(password);

    // ------------------------
    // EMAIL FEEDBACK
    // ------------------------
    if (!validEmail && email !== '') {
      emailFeedback.textContent = 'Please enter a valid email address.';
      emailFeedback.style.color = 'red';
    } else {
      emailFeedback.textContent = '';
    }

    // ------------------------
    // PASSWORD FEEDBACK
    // ------------------------
    if (!validPassword && password !== '') {
      feedback.innerHTML =
        'Password must include:<br>' +
        '• At least 8 characters<br>' +
        '• One uppercase letter<br>' +
        '• One lowercase letter<br>' +
        '• One number<br>' +
        '• One special character (@$!%*?&)';
      feedback.style.color = 'red';
    } else if (!passwordsMatch && confirmPassword !== '') {
      feedback.textContent = 'Passwords must match to continue.';
    } else {
      feedback.textContent = '';
    }

    // ------------------------
    // ENABLE SUBMIT ONLY IF:
    // email valid, password strong, passwords match
    // ------------------------
    submitButton.disabled = !(validEmail && validPassword && passwordsMatch);
  };

  // ----------------------
  // EVENT LISTENERS
  // ----------------------
  emailInput.addEventListener('input', updateButtonState);
  passwordInput.addEventListener('input', updateButtonState);
  confirmInput.addEventListener('input', updateButtonState);

  form.addEventListener('submit', event => {
    if (submitButton.disabled) {
      event.preventDefault();
      updateButtonState();
    }
  });

  updateButtonState();
});
