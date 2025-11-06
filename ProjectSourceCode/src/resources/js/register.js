document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('registerForm');
  if (!form) {
    return;
  }

  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');
  const submitButton = document.getElementById('registerSubmit');
  const feedback = document.getElementById('passwordFeedback');

  const updateButtonState = () => {
    const password = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();
    const passwordsMatch = password !== '' && password === confirmPassword;

    submitButton.disabled = !passwordsMatch;

    if (!passwordsMatch && confirmPassword !== '') {
      feedback.textContent = 'Passwords must match to continue.';
    } else {
      feedback.textContent = '';
    }
  };

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
