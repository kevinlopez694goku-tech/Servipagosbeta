(function () {
  const {
    ADMIN_SEED,
    countClients,
    getAdminProfile,
    initializeDatabase,
    recoverClientPassword,
    verifyAdminCredentials,
    verifyClientCredentials,
  } = window.ServiPagosDB;

  const roleButtons = document.querySelectorAll(".role-btn");
  const roleInfo = document.getElementById("roleInfo");
  const loginForm = document.getElementById("loginForm");
  const feedback = document.getElementById("feedback");
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("password");
  const emailInput = document.getElementById("email");
  const submitBtn = document.getElementById("submitBtn");
  const demoTitle = document.getElementById("demoTitle");
  const demoList = document.getElementById("demoList");
  const recoveryToggle = document.getElementById("recoveryToggle");
  const recoveryPanel = document.getElementById("recoveryPanel");
  const recoveryClose = document.getElementById("recoveryClose");
  const recoveryForm = document.getElementById("recoveryForm");
  const recoveryFeedback = document.getElementById("recoveryFeedback");
  const recoverySubmitBtn = document.getElementById("recoverySubmitBtn");
  const recoveryEmail = document.getElementById("recoveryEmail");
  const recoverySupplyCode = document.getElementById("recoverySupplyCode");
  const recoveryDocument = document.getElementById("recoveryDocument");
  const recoveryPassword = document.getElementById("recoveryPassword");
  const recoveryPasswordConfirm = document.getElementById("recoveryPasswordConfirm");

  const STORAGE_KEYS = {
    session: "servipagos-session",
    selectedRole: "servipagos-role",
  };

  const roleContent = {
    user: {
      title: "Portal de usuario",
      text: "Ingresa con una cuenta creada por el administrador para consultar facturas y pagos.",
      button: "Entrar como usuario",
      placeholder: "cliente@correo.com",
      demoTitleText: "Base de datos de clientes",
      demoHtml:
        "<li><strong>Guardado:</strong> los clientes quedan persistidos en la base de datos local del navegador.</li><li><strong>Ingreso:</strong> usa el correo y la contrasena asignados por el admin.</li>",
    },
    admin: {
      title: "Panel administrativo",
      text: "Accede con la cuenta unica del administrador para registrar, editar y eliminar clientes.",
      button: "Entrar como administrador",
      placeholder: ADMIN_SEED.email,
      demoTitleText: "Cuenta unica de administrador",
      demoHtml:
        `<li><strong>Correo:</strong> ${ADMIN_SEED.email}</li><li><strong>Contrasena:</strong> ${ADMIN_SEED.password}</li>`,
    },
  };

  let selectedRole = "user";
  let currentAdminProfile = null;

  function setSession(sessionData) {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(sessionData));
  }

  function setRecoveryVisible(isVisible) {
    if (!recoveryPanel) {
      return;
    }

    recoveryPanel.classList.toggle("hidden-panel", !isVisible);

    if (!isVisible) {
      recoveryFeedback.textContent = "";
      recoveryFeedback.className = "feedback";
      recoveryForm.reset();
    }
  }

  function updateRole(role) {
    selectedRole = role;

    roleButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.role === role);
    });

    roleInfo.innerHTML = `
      <h3>${roleContent[role].title}</h3>
      <p>${roleContent[role].text}</p>
    `;

    const currentAdminEmail = currentAdminProfile?.email || ADMIN_SEED.email;

    emailInput.placeholder = role === "admin" ? currentAdminEmail : roleContent[role].placeholder;
    submitBtn.textContent = roleContent[role].button;
    demoTitle.textContent = role === "admin" ? "Cuenta administrativa activa" : roleContent[role].demoTitleText;
    demoList.innerHTML = role === "admin"
      ? `<li><strong>Correo actual:</strong> ${currentAdminEmail}</li><li><strong>Acceso:</strong> usa la contrasena administrativa configurada en el sistema.</li>`
      : roleContent[role].demoHtml;
    feedback.textContent = "";
    feedback.className = "feedback";
    setRecoveryVisible(false);

    if (role === "admin") {
      recoveryToggle.textContent = "Solo clientes";
      recoveryToggle.disabled = true;
      recoveryToggle.style.opacity = "0.55";
      recoveryToggle.style.cursor = "not-allowed";
    } else {
      recoveryToggle.textContent = "Olvidaste tu contrasena?";
      recoveryToggle.disabled = false;
      recoveryToggle.style.opacity = "1";
      recoveryToggle.style.cursor = "pointer";
    }

    localStorage.setItem(STORAGE_KEYS.selectedRole, role);
  }

  roleButtons.forEach((button) => {
    button.addEventListener("click", () => updateRole(button.dataset.role));
  });

  togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    togglePassword.textContent = isPassword ? "Ocultar" : "Mostrar";
  });

  recoveryToggle.addEventListener("click", () => {
    if (selectedRole !== "user") {
      return;
    }

    setRecoveryVisible(recoveryPanel.classList.contains("hidden-panel"));

    if (!recoveryPanel.classList.contains("hidden-panel")) {
      recoveryEmail.value = emailInput.value.trim().toLowerCase();
      recoveryEmail.focus();
    }
  });

  recoveryClose.addEventListener("click", () => {
    setRecoveryVisible(false);
  });

  recoverySupplyCode.addEventListener("input", () => {
    recoverySupplyCode.value = recoverySupplyCode.value.toUpperCase();
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();

    if (!email || !password) {
      feedback.textContent = "Completa el correo y la contrasena para continuar.";
      feedback.className = "feedback error";
      return;
    }

    submitBtn.disabled = true;

    try {
      if (selectedRole === "admin") {
        const admin = await verifyAdminCredentials(email, password);

        if (!admin) {
          feedback.textContent = "Las credenciales del administrador no son correctas.";
          feedback.className = "feedback error";
          return;
        }

        setSession({
          role: "admin",
          name: admin.name,
          email: admin.email,
        });

        feedback.textContent = "Acceso administrativo validado. Redirigiendo al panel.";
        feedback.className = "feedback success";

        window.setTimeout(() => {
          window.location.href = "admin-dashboard.html";
        }, 700);

        return;
      }

      const client = await verifyClientCredentials(email, password);

      if (!client) {
        const clientCount = await countClients();
        feedback.textContent =
          clientCount === 0
            ? "Todavia no hay clientes registrados. Primero entra como administrador y crea una cuenta."
            : "No existe un cliente con ese correo y contrasena.";
        feedback.className = "feedback error";
        return;
      }

      setSession({
        role: "user",
        clientId: client.id,
        name: client.name,
        email: client.email,
      });

      feedback.textContent = "Inicio de sesion correcto. Redirigiendo a tu dashboard.";
      feedback.className = "feedback success";

      window.setTimeout(() => {
        window.location.href = "user-dashboard.html";
      }, 700);
    } finally {
      submitBtn.disabled = false;
    }
  });

  recoveryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = recoveryEmail.value.trim().toLowerCase();
    const supplyCode = recoverySupplyCode.value.trim().toUpperCase();
    const documentId = recoveryDocument.value.trim();
    const newPassword = recoveryPassword.value.trim();
    const confirmPassword = recoveryPasswordConfirm.value.trim();

    if (!email || !supplyCode || !newPassword || !confirmPassword) {
      recoveryFeedback.textContent = "Completa los datos requeridos para recuperar el acceso.";
      recoveryFeedback.className = "feedback error";
      return;
    }

    if (newPassword.length < 6) {
      recoveryFeedback.textContent = "La nueva contrasena debe tener al menos 6 caracteres.";
      recoveryFeedback.className = "feedback error";
      return;
    }

    if (newPassword !== confirmPassword) {
      recoveryFeedback.textContent = "La confirmacion de contrasena no coincide.";
      recoveryFeedback.className = "feedback error";
      return;
    }

    recoverySubmitBtn.disabled = true;

    try {
      await recoverClientPassword({
        email,
        supplyCode,
        documentId,
        newPassword,
      });

      recoveryFeedback.textContent = "Contrasena actualizada correctamente. Ya puedes iniciar sesion con tu nueva clave.";
      recoveryFeedback.className = "feedback success";
      emailInput.value = email;
      passwordInput.value = newPassword;

      window.setTimeout(() => {
        setRecoveryVisible(false);
      }, 1200);
    } catch (error) {
      recoveryFeedback.textContent =
        error.message === "CLIENT_NOT_FOUND"
          ? "No existe un cliente con ese correo."
          : error.message === "INVALID_SUPPLY_CODE"
            ? "El codigo de suministro no coincide con la cuenta."
            : error.message === "DOCUMENT_REQUIRED"
              ? "Esta cuenta tiene documento registrado. Debes escribirlo para continuar."
              : error.message === "DOCUMENT_MISMATCH"
                ? "El documento no coincide con el registrado en el perfil."
                : error.message === "INVALID_PASSWORD"
                  ? "La nueva contrasena no cumple con el minimo requerido."
                  : "No se pudo recuperar la contrasena. Intenta nuevamente.";
      recoveryFeedback.className = "feedback error";
    } finally {
      recoverySubmitBtn.disabled = false;
    }
  });

  initializeDatabase().then(async () => {
    currentAdminProfile = await getAdminProfile();
    const savedRole = localStorage.getItem(STORAGE_KEYS.selectedRole);
    if (savedRole && roleContent[savedRole]) {
      updateRole(savedRole);
    } else {
      updateRole("user");
    }
  });
})();
