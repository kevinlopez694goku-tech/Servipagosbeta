(function () {
  const {
    createClient,
    deleteClient,
    getAdminProfile,
    getClientById,
    getClients,
    initializeDatabase,
    processClientPayment,
    updateClient,
    updateAdminSettings,
    updateClientProfile,
  } = window.ServiPagosDB;

  const pageRole = document.body.dataset.role;
  const welcomeName = document.querySelector("[data-user-name]");
  const welcomeEmail = document.querySelector("[data-user-email]");
  const welcomeRole = document.querySelector("[data-role-label]");
  const logoutButtons = document.querySelectorAll("[data-logout]");

  const STORAGE_KEYS = {
    session: "servipagos-session",
    selectedRole: "servipagos-role",
    adminNotifications: "servipagos-admin-notifications",
    userNotificationsPrefix: "servipagos-user-notifications",
  };

  const roleLabels = {
    user: "Cliente",
    admin: "Administrador",
  };

  const adminState = {
    editingId: null,
    notifications: [],
    reviewedNotificationIds: [],
  };
  const userState = {
    notifications: [],
    reviewedNotificationIds: [],
  };
  const profileState = {
    pendingPhotoDataUrl: null,
    removePhoto: false,
  };
  let currentClientData = null;

  const monthLabels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  function getSession() {
    const rawSession = localStorage.getItem(STORAGE_KEYS.session);

    if (!rawSession) {
      return null;
    }

    try {
      return JSON.parse(rawSession);
    } catch (error) {
      return null;
    }
  }

  function saveSession(session) {
    const serialized = JSON.stringify(session);
    localStorage.setItem(STORAGE_KEYS.session, serialized);
    sessionStorage.setItem(STORAGE_KEYS.session, serialized);
  }

  function getAdminNotificationState() {
    const rawState = localStorage.getItem(STORAGE_KEYS.adminNotifications);

    if (!rawState) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawState);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveAdminNotificationState(ids) {
    localStorage.setItem(STORAGE_KEYS.adminNotifications, JSON.stringify(ids));
  }

  function getUserNotificationStorageKey(clientId) {
    return `${STORAGE_KEYS.userNotificationsPrefix}-${clientId}`;
  }

  function getUserNotificationState(clientId) {
    const rawState = localStorage.getItem(getUserNotificationStorageKey(clientId));

    if (!rawState) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawState);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveUserNotificationState(clientId, ids) {
    localStorage.setItem(getUserNotificationStorageKey(clientId), JSON.stringify(ids));
  }

  function formatCurrency(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(dateValue) {
    if (!dateValue) {
      return "Sin fecha";
    }

    const [year, month, day] = dateValue.split("-");

    if (!year || !month || !day) {
      return dateValue;
    }

    return `${day}/${month}/${year}`;
  }

  function formatDateTime(dateValue) {
    if (!dateValue) {
      return "Sin fecha";
    }

    const parsedDate = new Date(dateValue);

    if (Number.isNaN(parsedDate.getTime())) {
      return dateValue;
    }

    const day = String(parsedDate.getDate()).padStart(2, "0");
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const year = parsedDate.getFullYear();
    const hours = String(parsedDate.getHours()).padStart(2, "0");
    const minutes = String(parsedDate.getMinutes()).padStart(2, "0");

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  function isDueWithinDays(dateValue, days) {
    if (!dateValue) {
      return false;
    }

    const now = new Date();
    const target = new Date(`${dateValue}T23:59:59`);

    if (Number.isNaN(target.getTime())) {
      return false;
    }

    const diffMs = target.getTime() - now.getTime();
    const dayMs = 1000 * 60 * 60 * 24;
    const diffDays = diffMs / dayMs;

    return diffDays >= 0 && diffDays <= days;
  }

  function isRecentIsoDate(dateValue, hours) {
    if (!dateValue) {
      return false;
    }

    const parsedDate = new Date(dateValue);

    if (Number.isNaN(parsedDate.getTime())) {
      return false;
    }

    const diffMs = Date.now() - parsedDate.getTime();
    return diffMs >= 0 && diffMs <= hours * 60 * 60 * 1000;
  }

  function getInitials(name) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  function setAdminIdentity(admin) {
    const initials = getInitials(admin.name || "Administrador");

    setText("[data-user-name]", admin.name);
    setText("[data-user-email]", admin.email);
    setText("[data-admin-current-email]", admin.email);
    setText("[data-admin-chip]", admin.name || "Control central");
    setText("[data-admin-initials]", initials);
  }

  function getStatusClass(status) {
    const normalizedStatus = status.toLowerCase();

    if (normalizedStatus.includes("venc")) {
      return "status-red";
    }

    if (normalizedStatus.includes("dia")) {
      return "status-green";
    }

    if (normalizedStatus.includes("pend")) {
      return "status-orange";
    }

    return "status-blue";
  }

  function getServiceIconClass(service) {
    const normalizedService = service.toLowerCase();

    if (normalizedService.includes("agua")) {
      return "icon-water";
    }

    if (normalizedService.includes("internet")) {
      return "icon-admin";
    }

    return "icon-energy";
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  }

  function setInputValue(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.value = value || "";
    }
  }

  function setStatusBadge(selector, status) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = status;
      element.className = `status-tag ${getStatusClass(status)}`;
    });
  }

  function displayOrFallback(value, fallback = "Sin registrar") {
    return value && String(value).trim() ? value : fallback;
  }

  function setAvatarDisplay(initials, photoUrl) {
    document.querySelectorAll("[data-user-avatar], [data-profile-photo-preview]").forEach((element) => {
      element.textContent = initials;

      if (photoUrl) {
        element.style.backgroundImage = `url("${photoUrl}")`;
        element.classList.add("has-photo");
      } else {
        element.style.backgroundImage = "";
        element.classList.remove("has-photo");
      }
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("FILE_READ_ERROR"));
      reader.readAsDataURL(file);
    });
  }

  function renderServicesList(client) {
    const servicesList = document.querySelector("[data-services-list]");

    if (!servicesList) {
      return;
    }

    servicesList.innerHTML = `
      <li>${escapeHtml(client.service)}</li>
      <li>Codigo ${escapeHtml(client.supplyCode)}</li>
      <li>Estado: ${escapeHtml(client.status)}</li>
    `;
  }

  function getAdminMetrics(clients) {
    const totalDue = clients.reduce((sum, client) => sum + Number(client.amountDue || 0), 0);
    const overdueClients = clients.filter((client) => client.status === "Vencido").length;
    const activeClients = clients.length;
    const activeServices = new Set(clients.map((client) => client.service)).size;

    return {
      totalDue,
      overdueClients,
      activeClients,
      activeServices,
    };
  }

  function buildAdminNotifications(admin, clients) {
    const notifications = [];
    const overdueClients = clients.filter((client) => client.status === "Vencido");
    const dueSoonClients = clients.filter((client) => client.amountDue > 0 && isDueWithinDays(client.dueDate, 3));
    const clientsWithoutDocument = clients.filter((client) => !String(client.documentId || "").trim());
    const recentPayments = clients.reduce((total, client) => {
      const payments = getPaymentHistory(client).filter((payment) => {
        const paymentDate = new Date(payment.paidAt);
        const diffMs = Date.now() - paymentDate.getTime();
        return diffMs >= 0 && diffMs <= 1000 * 60 * 60 * 24 * 2;
      });

      return total + payments.length;
    }, 0);

    if (overdueClients.length > 0) {
      notifications.push({
        id: "overdue-accounts",
        iconClass: "icon-energy",
        iconText: "CRI",
        title: "Cuentas vencidas detectadas",
        text: `${overdueClients.length} cliente(s) registran saldo vencido y requieren seguimiento inmediato.`,
        detail: overdueClients.slice(0, 3).map((client) => client.name).join(", ") || "Sin detalle",
        statusClass: "status-red",
        statusText: "Critica",
        actionLabel: "Revisar clientes",
        actionHref: "#gestion-clientes",
      });
    }

    if (dueSoonClients.length > 0) {
      notifications.push({
        id: "due-soon-clients",
        iconClass: "icon-water",
        iconText: "VNC",
        title: "Vencimientos proximos",
        text: `${dueSoonClients.length} cuenta(s) vencen en los proximos 3 dias.`,
        detail: dueSoonClients.slice(0, 3).map((client) => `${client.name} (${formatDate(client.dueDate)})`).join(", "),
        statusClass: "status-orange",
        statusText: "Atencion",
        actionLabel: "Ir a cartera",
        actionHref: "#facturacion-admin",
      });
    }

    if (recentPayments > 0) {
      notifications.push({
        id: "recent-payments",
        iconClass: "icon-admin",
        iconText: "PAG",
        title: "Pagos recientes acreditados",
        text: `Se registraron ${recentPayments} pago(s) en las ultimas 48 horas.`,
        detail: "La actividad ya impacta indicadores y cartera pendiente.",
        statusClass: "status-green",
        statusText: "Nuevo",
        actionLabel: "Ver resumen",
        actionHref: "#vista-ejecutiva",
      });
    }

    if (clientsWithoutDocument.length > 0) {
      notifications.push({
        id: "missing-documents",
        iconClass: "icon-water",
        iconText: "SEG",
        title: "Perfiles incompletos para recuperacion",
        text: `${clientsWithoutDocument.length} cliente(s) aun no registran documento en su perfil.`,
        detail: "Completar ese dato mejora la recuperacion de contrasena y la seguridad del sistema.",
        statusClass: "status-blue",
        statusText: "Seguridad",
        actionLabel: "Gestionar clientes",
        actionHref: "#gestion-clientes",
      });
    }

    if (!admin.supportEmail || admin.supportEmail === admin.email) {
      notifications.push({
        id: "support-email-pending",
        iconClass: "icon-admin",
        iconText: "CFG",
        title: "Canal de soporte por configurar",
        text: "Conviene definir un correo de soporte independiente del acceso principal del administrador.",
        detail: "Asi separas la operacion diaria del inicio de sesion maestro.",
        statusClass: "status-blue",
        statusText: "Mejora",
        actionLabel: "Abrir configuracion",
        actionHref: "admin-settings.html",
      });
    }

    if (clients.length === 0) {
      notifications.push({
        id: "no-clients-yet",
        iconClass: "icon-energy",
        iconText: "INI",
        title: "Sin clientes registrados",
        text: "El sistema aun no tiene clientes activos cargados por el administrador.",
        detail: "Crea la primera cuenta para activar el flujo completo de pagos y facturas.",
        statusClass: "status-orange",
        statusText: "Inicio",
        actionLabel: "Crear cliente",
        actionHref: "#gestion-clientes",
      });
    }

    if (notifications.length === 0) {
      notifications.push({
        id: "system-stable",
        iconClass: "icon-admin",
        iconText: "OK",
        title: "Sistema estable",
        text: "No hay alertas prioritarias en este momento.",
        detail: "La operacion administrativa se encuentra al dia.",
        statusClass: "status-green",
        statusText: "Normal",
        actionLabel: "Ver panel",
        actionHref: "#vista-ejecutiva",
      });
    }

    return notifications;
  }

  function renderAdminNotifications(notifications) {
    const notificationList = document.querySelector("[data-admin-notifications-list]");
    const historyList = document.querySelector("[data-admin-notifications-history]");
    const reviewedIds = adminState.reviewedNotificationIds;
    const unreadNotifications = notifications.filter((notification) => !reviewedIds.includes(notification.id));
    const reviewedNotifications = notifications.filter((notification) => reviewedIds.includes(notification.id));

    adminState.notifications = notifications;
    setText("[data-admin-alerts]", String(unreadNotifications.length).padStart(2, "0"));
    setText(
      "[data-admin-notification-summary]",
      unreadNotifications.length > 0
        ? `Tienes ${unreadNotifications.length} notificacion(es) activas que requieren revision.`
        : "No hay notificaciones activas. Todo el sistema se encuentra al dia."
    );
    setText(
      "[data-admin-live-feed]",
      reviewedNotifications.length > 0
        ? `Has revisado ${reviewedNotifications.length} notificacion(es). Puedes restaurarlas si deseas volver a verlas.`
        : "Las notificaciones revisadas apareceran aqui como historial operativo."
    );

    if (notificationList) {
      notificationList.innerHTML = unreadNotifications.length > 0
        ? unreadNotifications.map((notification) => `
          <div class="notice-item">
            <div class="icon-pill ${notification.iconClass}">${escapeHtml(notification.iconText)}</div>
            <div class="notice-copy">
              <strong>${escapeHtml(notification.title)}</strong>
              <p>${escapeHtml(notification.text)}</p>
              <small>${escapeHtml(notification.detail)}</small>
            </div>
            <div class="notice-actions">
              <span class="status-tag ${notification.statusClass}">${escapeHtml(notification.statusText)}</span>
              <a class="ghost-btn compact-btn nav-action" href="${escapeHtml(notification.actionHref)}">${escapeHtml(notification.actionLabel)}</a>
              <button class="ghost-btn compact-btn" type="button" data-review-notification="${escapeHtml(notification.id)}">Marcar revisada</button>
            </div>
          </div>
        `).join("")
        : `<div class="empty-state">No hay alertas activas. El sistema administrativo luce estable.</div>`;
    }

    if (historyList) {
      historyList.innerHTML = reviewedNotifications.length > 0
        ? reviewedNotifications.map((notification) => `
          <div class="notice-item reviewed-notice">
            <div class="icon-pill ${notification.iconClass}">${escapeHtml(notification.iconText)}</div>
            <div class="notice-copy">
              <strong>${escapeHtml(notification.title)}</strong>
              <p>${escapeHtml(notification.text)}</p>
              <small>${escapeHtml(notification.detail)}</small>
            </div>
            <div class="notice-actions">
              <span class="status-tag status-green">Revisada</span>
              <button class="ghost-btn compact-btn" type="button" data-unreview-notification="${escapeHtml(notification.id)}">Reactivar</button>
            </div>
          </div>
        `).join("")
        : `<div class="empty-state">Aun no has marcado notificaciones como revisadas.</div>`;
    }
  }

  function buildUserNotifications(client) {
    const notifications = [];
    const history = getPaymentHistory(client);
    const latestPayment = history[0] || null;
    const hasIncompleteProfile = !String(client.documentId || "").trim() || !String(client.phone || "").trim();

    if (client.status === "Vencido" || Number(client.amountDue || 0) > 50) {
      notifications.push({
        id: "user-overdue-balance",
        iconClass: "icon-energy",
        iconText: "URG",
        title: "Saldo vencido pendiente",
        text: `Tu cuenta de ${client.service} registra ${formatCurrency(client.amountDue)} vencidos.`,
        detail: "Realiza el pago cuanto antes para evitar recargos o suspension del servicio.",
        statusClass: "status-red",
        statusText: "Urgente",
        actionLabel: "Pagar ahora",
        actionHref: "#payment-panel",
      });
    }

    if (Number(client.amountDue || 0) > 0 && isDueWithinDays(client.dueDate, 3)) {
      notifications.push({
        id: "user-due-soon",
        iconClass: "icon-water",
        iconText: "VNC",
        title: "Factura por vencer",
        text: `Tu pago de ${client.service} vence el ${formatDate(client.dueDate)}.`,
        detail: `Saldo actual pendiente: ${formatCurrency(client.amountDue)}.`,
        statusClass: "status-orange",
        statusText: "Atencion",
        actionLabel: "Ver factura",
        actionHref: "facturas.html",
      });
    }

    if (latestPayment && isRecentIsoDate(latestPayment.paidAt, 48)) {
      notifications.push({
        id: `user-payment-${latestPayment.id}`,
        iconClass: "icon-admin",
        iconText: "PAG",
        title: "Pago acreditado correctamente",
        text: `Se registro un pago reciente de ${formatCurrency(latestPayment.amount)} con la tarjeta ${latestPayment.cardMasked}.`,
        detail: `Fecha de aplicacion: ${formatDateTime(latestPayment.paidAt)}.`,
        statusClass: "status-green",
        statusText: "Nuevo",
        actionLabel: "Ver comprobante",
        actionHref: "facturas.html",
      });
    }

    if (hasIncompleteProfile) {
      notifications.push({
        id: "user-profile-incomplete",
        iconClass: "icon-water",
        iconText: "SEG",
        title: "Perfil incompleto para seguridad",
        text: "Completa tu telefono y documento para mejorar la recuperacion de contrasena.",
        detail: "Actualizar estos datos protege mejor tu acceso y facilita la validacion de identidad.",
        statusClass: "status-blue",
        statusText: "Seguridad",
        actionLabel: "Completar perfil",
        actionHref: "perfil.html",
      });
    }

    if (Number(client.amountDue || 0) === 0 && Number(client.discount || 0) > 0) {
      notifications.push({
        id: "user-discount-active",
        iconClass: "icon-admin",
        iconText: "BON",
        title: "Descuento activo por puntualidad",
        text: `Tu cuenta esta al dia y mantiene un beneficio del ${client.discount}% por buen comportamiento de pago.`,
        detail: "Sigue pagando antes del vencimiento para conservar ese beneficio.",
        statusClass: "status-green",
        statusText: "Beneficio",
        actionLabel: "Ver perfil",
        actionHref: "perfil.html",
      });
    }

    if (history.length === 0) {
      notifications.push({
        id: "user-first-payment",
        iconClass: "icon-energy",
        iconText: "INI",
        title: "Cuenta lista para tu primer pago",
        text: "Tu administrador ya habilito tu acceso. Aun no registras pagos en el sistema.",
        detail: "Cuando hagas tu primer pago, el historial y las graficas se actualizaran automaticamente.",
        statusClass: "status-blue",
        statusText: "Inicio",
        actionLabel: "Pagar servicio",
        actionHref: "#payment-panel",
      });
    }

    if (notifications.length === 0) {
      notifications.push({
        id: "user-system-normal",
        iconClass: "icon-admin",
        iconText: "OK",
        title: "Cuenta sin novedades",
        text: "No hay alertas nuevas en este momento.",
        detail: "Tu servicio y tus pagos se encuentran estables.",
        statusClass: "status-green",
        statusText: "Normal",
        actionLabel: "Ver detalle",
        actionHref: "facturas.html",
      });
    }

    return notifications;
  }

  function renderUserNotifications(client, notifications) {
    const notificationList = document.querySelector("[data-user-notifications-list]");
    const summary = document.querySelector("[data-user-notification-summary]");

    if (!notificationList || !summary) {
      return;
    }

    userState.notifications = notifications;
    userState.reviewedNotificationIds = getUserNotificationState(client.id);

    const unreadNotifications = notifications.filter(
      (notification) => !userState.reviewedNotificationIds.includes(notification.id)
    );
    const alertBadge = document.querySelector("[data-user-alert-badge]");

    setText("[data-user-alerts]", String(unreadNotifications.length).padStart(2, "0"));
    summary.textContent = unreadNotifications.length > 0
      ? `Tienes ${unreadNotifications.length} notificacion(es) automatica(s) activas segun tu estado de cuenta.`
      : "No hay notificaciones activas. Tu cuenta se encuentra estable.";

    if (alertBadge) {
      alertBadge.textContent = unreadNotifications.length > 0 ? "Activas" : "Estable";
      alertBadge.className = `status-tag ${unreadNotifications.length > 0 ? "status-red" : "status-green"}`;
    }

    notificationList.innerHTML = unreadNotifications.length > 0
      ? unreadNotifications.map((notification) => `
        <div class="notice-item">
          <div class="icon-pill ${notification.iconClass}">${escapeHtml(notification.iconText)}</div>
          <div class="notice-copy">
            <strong>${escapeHtml(notification.title)}</strong>
            <p>${escapeHtml(notification.text)}</p>
            <small>${escapeHtml(notification.detail)}</small>
          </div>
          <div class="notice-actions">
            <span class="status-tag ${notification.statusClass}">${escapeHtml(notification.statusText)}</span>
            <a class="ghost-btn compact-btn nav-action" href="${escapeHtml(notification.actionHref)}">${escapeHtml(notification.actionLabel)}</a>
            <button class="ghost-btn compact-btn" type="button" data-read-user-notification="${escapeHtml(notification.id)}">Marcar leida</button>
          </div>
        </div>
      `).join("")
      : `<div class="empty-state">No hay notificaciones nuevas para tu cuenta. Puedes restaurarlas si quieres volver a verlas.</div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getRecentSixMonths() {
    const months = [];
    const now = new Date();

    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        label: monthLabels[date.getMonth()],
      });
    }

    return months;
  }

  function getPaymentHistory(client) {
    return Array.isArray(client.paymentHistory) ? client.paymentHistory : [];
  }

  function findPaymentById(client, paymentId) {
    return getPaymentHistory(client).find((payment) => payment.id === paymentId) || null;
  }

  function subtractDays(dateValue, days) {
    if (!dateValue) {
      return null;
    }

    const date = new Date(dateValue);
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }

  function getInvoiceDetails(client) {
    const paymentHistory = getPaymentHistory(client);
    const dueAmount = Number(client.amountDue || 0);
    const dueMonthKey = client.dueDate ? client.dueDate.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const cyclePayments = paymentHistory
      .filter((payment) => payment.monthKey === dueMonthKey)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    const totalBilled = Number((dueAmount + cyclePayments).toFixed(2));
    const baseCharge = Number((totalBilled * 0.72).toFixed(2));
    const maintenance = Number((totalBilled * 0.12).toFixed(2));
    const taxes = Number((totalBilled - baseCharge - maintenance).toFixed(2));
    const issuedDate = subtractDays(client.dueDate, 15) || new Date().toISOString().slice(0, 10);
    const status =
      dueAmount <= 0 ? "Pagada" : client.status === "Vencido" ? "Vencida" : "Pendiente";

    return {
      number: `FAC-${client.supplyCode.slice(-4)}-${dueMonthKey.replace("-", "")}`,
      issuedDate,
      period: dueMonthKey,
      totalBilled,
      breakdown: [
        { label: "Consumo base del servicio", amount: baseCharge },
        { label: "Cargo de mantenimiento", amount: maintenance },
        { label: "Impuestos y tasas", amount: taxes },
      ],
      status,
      cyclePayments,
    };
  }

  function buildReceiptHtml(client, payment, options = {}) {
    const invoice = getInvoiceDetails(client);
    const receiptNumber = `REC-${String(payment.id || "0000").slice(-8).toUpperCase()}`;
    const statusText = Number(client.amountDue || 0) <= 0 ? "Cuenta al dia" : "Pago aplicado";
    const helperText = options.pdfMode
      ? "En la ventana de impresion elige Guardar como PDF para exportar el comprobante."
      : "Puedes imprimir este comprobante o cerrarlo cuando termines.";
    const toolbar = options.interactive
      ? `
        <div class="receipt-tools">
          <div>
            <strong>Comprobante listo</strong>
            <p>${escapeHtml(helperText)}</p>
          </div>
          <div class="receipt-tool-actions">
            <button type="button" onclick="window.print()">Imprimir</button>
            <button type="button" onclick="window.close()">Cerrar</button>
          </div>
        </div>
      `
      : "";
    const autoPrintScript = options.autoPrint
      ? `
        <script>
          window.addEventListener("load", function () {
            setTimeout(function () {
              window.print();
            }, 350);
          });
        </script>
      `
      : "";

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Comprobante ${escapeHtml(receiptNumber)}</title>
        <style>
          :root {
            color-scheme: light;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 32px;
            font-family: Arial, sans-serif;
            color: #0f172a;
            background: #f8fafc;
          }
          .receipt-tools {
            max-width: 820px;
            margin: 0 auto 18px;
            padding: 16px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            border: 1px solid #dbe3ee;
            border-radius: 18px;
            background: #ffffff;
          }
          .receipt-tools p {
            margin: 6px 0 0;
            color: #64748b;
          }
          .receipt-tool-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }
          .receipt-tool-actions button {
            border: 0;
            padding: 10px 14px;
            border-radius: 999px;
            background: #0f172a;
            color: #ffffff;
            font-weight: 700;
            cursor: pointer;
          }
          .receipt {
            max-width: 820px;
            margin: 0 auto;
            background: #ffffff;
            border: 1px solid #dbe3ee;
            border-radius: 20px;
            overflow: hidden;
          }
          .receipt-header {
            padding: 28px 32px;
            background: linear-gradient(135deg, #0f172a, #172554);
            color: #ffffff;
          }
          .receipt-header h1 {
            margin: 0 0 8px;
            font-size: 28px;
          }
          .receipt-header p {
            margin: 0;
            color: rgba(255, 255, 255, 0.78);
          }
          .receipt-body {
            padding: 32px;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
            margin-bottom: 24px;
          }
          .card {
            padding: 18px;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            background: #f8fafc;
          }
          .label {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #64748b;
          }
          .value {
            font-size: 20px;
            font-weight: 700;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 18px;
          }
          th, td {
            padding: 14px 12px;
            border-bottom: 1px solid #e2e8f0;
            text-align: left;
          }
          th {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
          }
          .total-row td {
            font-weight: 700;
          }
          .footer {
            padding: 0 32px 32px;
            color: #475569;
            line-height: 1.6;
          }
          @media print {
            body {
              padding: 0;
              background: #ffffff;
            }
            .receipt-tools {
              display: none;
            }
            .receipt {
              border: 0;
              border-radius: 0;
            }
          }
        </style>
      </head>
      <body>
        ${toolbar}
        <article class="receipt">
          <header class="receipt-header">
            <h1>Comprobante de pago</h1>
            <p>ServiPagos | Sistema de servicios basicos</p>
          </header>
          <section class="receipt-body">
            <div class="grid">
              <div class="card">
                <span class="label">Cliente</span>
                <div class="value">${escapeHtml(client.name)}</div>
              </div>
              <div class="card">
                <span class="label">Comprobante</span>
                <div class="value">${escapeHtml(receiptNumber)}</div>
              </div>
              <div class="card">
                <span class="label">Servicio</span>
                <div class="value">${escapeHtml(payment.service || client.service)}</div>
              </div>
              <div class="card">
                <span class="label">Fecha y hora</span>
                <div class="value">${escapeHtml(formatDateTime(payment.paidAt))}</div>
              </div>
              <div class="card">
                <span class="label">Tarjeta</span>
                <div class="value">${escapeHtml(payment.cardMasked || "Tarjeta registrada")}</div>
              </div>
              <div class="card">
                <span class="label">Titular</span>
                <div class="value">${escapeHtml(payment.cardHolder || client.name)}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Monto pagado</td>
                  <td>${escapeHtml(formatCurrency(payment.amount))}</td>
                </tr>
                <tr>
                  <td>Factura asociada</td>
                  <td>${escapeHtml(invoice.number)}</td>
                </tr>
                <tr>
                  <td>Estado del pago</td>
                  <td>Aprobado</td>
                </tr>
                <tr>
                  <td>Saldo restante</td>
                  <td>${escapeHtml(formatCurrency(client.amountDue))}</td>
                </tr>
                <tr class="total-row">
                  <td>Estado de cuenta</td>
                  <td>${escapeHtml(statusText)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <div class="footer">
            <p>Este comprobante fue generado automaticamente por ServiPagos.</p>
            <p>Cliente: ${escapeHtml(client.email)} | Suministro: ${escapeHtml(client.supplyCode)}</p>
          </div>
        </article>
        ${autoPrintScript}
      </body>
      </html>
    `;
  }

  function downloadReceipt(client, payment) {
    const html = buildReceiptHtml(client, payment);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const receiptNumber = `comprobante-${String(payment.id || "pago").slice(-8).toLowerCase()}.html`;

    link.href = url;
    link.download = receiptNumber;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function openReceiptWindow(client, payment, options = {}) {
    const receiptWindow = window.open("", "_blank", "width=960,height=820");

    if (!receiptWindow) {
      downloadReceipt(client, payment);
      return;
    }

    receiptWindow.document.open();
    receiptWindow.document.write(buildReceiptHtml(client, payment, {
      interactive: true,
      autoPrint: Boolean(options.autoPrint),
      pdfMode: Boolean(options.pdfMode),
    }));
    receiptWindow.document.close();
  }

  function renderReceiptActions(paymentId, compact = false) {
    const compactClass = compact ? " compact-btn" : "";

    return `
      <div class="receipt-actions">
        <button class="ghost-btn${compactClass} download-btn" type="button" data-download-receipt="${escapeHtml(paymentId)}">
          Descargar
        </button>
        <button class="ghost-btn${compactClass} pdf-btn" type="button" data-export-pdf="${escapeHtml(paymentId)}">
          PDF
        </button>
        <button class="ghost-btn${compactClass} print-btn" type="button" data-print-receipt="${escapeHtml(paymentId)}">
          Imprimir
        </button>
      </div>
    `;
  }

  function getActivityItems(client) {
    const history = getPaymentHistory(client);
    const items = [
      {
        iconClass: "icon-admin",
        iconText: "OK",
        title: "Acceso correcto",
        text: "Tu cuenta fue validada con las credenciales asignadas por el administrador.",
        statusClass: "status-green",
        statusText: "Hoy",
      },
      {
        iconClass: "icon-water",
        iconText: "SV",
        title: "Servicio vinculado",
        text: `Tu cuenta mantiene activo el servicio ${client.service}.`,
        statusClass: "status-blue",
        statusText: "Activo",
      },
    ];

    if (history.length > 0) {
      const lastPayment = history[0];
      items.unshift({
        iconClass: "icon-admin",
        iconText: "PG",
        title: "Pago acreditado",
        text: `Se registro un pago de ${formatCurrency(lastPayment.amount)} con la tarjeta ${lastPayment.cardMasked}.`,
        statusClass: "status-green",
        statusText: "Nuevo",
      });
    } else {
      items.push({
        iconClass: "icon-energy",
        iconText: "AL",
        title: "Recordatorio enviado",
        text: `Tu proximo vencimiento es ${formatDate(client.dueDate)}. Procesa tu pago para actualizar la grafica.`,
        statusClass: "status-orange",
        statusText: "Pendiente",
      });
    }

    return items.slice(0, 3);
  }

  function renderUserChart(client) {
    const chartTitle = document.querySelector("[data-user-chart-title]");
    const chartBars = document.querySelector("[data-user-chart-bars]");

    if (!chartTitle || !chartBars) {
      return;
    }

    const recentMonths = getRecentSixMonths();
    const history = getPaymentHistory(client);
    const grouped = {};

    history.forEach((payment) => {
      grouped[payment.monthKey] = (grouped[payment.monthKey] || 0) + Number(payment.amount || 0);
    });

    const values = recentMonths.map((month) => ({
      label: month.label,
      total: Number((grouped[month.key] || 0).toFixed(2)),
    }));

    const maxValue = Math.max(...values.map((item) => item.total), 1);
    const paidTotal = values.reduce((sum, item) => sum + item.total, 0);

    chartTitle.textContent =
      paidTotal > 0
        ? `Total pagado en los ultimos 6 meses: ${formatCurrency(paidTotal)}`
        : "Sin pagos registrados todavia";

    chartBars.innerHTML = values
      .map((item) => {
        const height = item.total > 0 ? Math.max(18, (item.total / maxValue) * 100) : 12;
        return `
          <div class="bar" style="height: ${height}%;">
            <span>${formatCurrency(item.total)}</span>
            <small>${escapeHtml(item.label)}</small>
          </div>
        `;
      })
      .join("");
  }

  function renderUserHistory(client) {
    const historyList = document.querySelector("[data-user-history-list]");
    const activityList = document.querySelector("[data-user-activity-list]");
    const discountNote = document.querySelector("[data-user-discount-note]");

    if (discountNote) {
      discountNote.textContent =
        client.discount > 0
          ? `Mantienes un beneficio del ${client.discount}% por buen comportamiento de pago.`
          : "Paga con tarjeta antes del vencimiento para activar descuentos por puntualidad.";
    }

    if (historyList) {
      const history = getPaymentHistory(client);

      if (history.length === 0) {
        historyList.innerHTML = `<div class="empty-state">Tus pagos procesados apareceran aqui.</div>`;
      } else {
        historyList.innerHTML = history.slice(0, 4).map((payment) => `
          <div class="notice-item">
            <div class="icon-pill icon-admin">PG</div>
            <div>
              <strong>${formatCurrency(payment.amount)} pagados</strong>
              <p>${escapeHtml(payment.service)} | ${escapeHtml(payment.cardMasked)} | ${escapeHtml(formatDate(payment.paidAt.slice(0, 10)))}</p>
            </div>
            ${renderReceiptActions(payment.id, true)}
          </div>
        `).join("");
      }
    }

    if (activityList) {
      activityList.innerHTML = getActivityItems(client).map((item) => `
        <div class="activity-item">
          <div class="icon-pill ${item.iconClass}">${escapeHtml(item.iconText)}</div>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.text)}</p>
          </div>
          <span class="status-tag ${item.statusClass}">${escapeHtml(item.statusText)}</span>
        </div>
      `).join("");
    }

    renderUserNotifications(client, buildUserNotifications(client));
  }

  function renderInvoicePage(client) {
    const invoice = getInvoiceDetails(client);
    const breakdownContainer = document.querySelector("[data-invoice-breakdown]");
    const historyTable = document.querySelector("[data-invoice-history-table]");
    const latestReceiptBox = document.querySelector("[data-latest-receipt-box]");
    const statusClass = getStatusClass(invoice.status);

    setText("[data-invoice-number]", invoice.number);
    setText("[data-invoice-status-text]", invoice.status);
    setText("[data-invoice-total]", formatCurrency(invoice.totalBilled));
    setText("[data-invoice-issued]", formatDate(invoice.issuedDate));
    setText("[data-invoice-period]", `${invoice.period} | ${client.service}`);
    setText("[data-invoice-status-badge]", invoice.status);
    setText("[data-user-total-due]", formatCurrency(client.amountDue));
    setText("[data-user-last-payment]", formatCurrency(client.lastPayment));
    setText("[data-user-payments]", String(client.completedPayments));
    setStatusBadge("[data-user-status]", client.status);

    const statusBadge = document.querySelector("[data-invoice-status-badge]");
    if (statusBadge) {
      statusBadge.className = `status-tag ${statusClass}`;
    }

    const statusText = document.querySelector("[data-invoice-status-text]");
    if (statusText) {
      statusText.textContent = invoice.status;
    }

    if (breakdownContainer) {
      breakdownContainer.innerHTML = invoice.breakdown.map((item) => `
        <div class="breakdown-row">
          <span>${escapeHtml(item.label)}</span>
          <strong>${formatCurrency(item.amount)}</strong>
        </div>
      `).join("") + `
        <div class="breakdown-row">
          <span>Total facturado</span>
          <strong>${formatCurrency(invoice.totalBilled)}</strong>
        </div>
        <div class="breakdown-row">
          <span>Total pagado en el periodo</span>
          <strong>${formatCurrency(invoice.cyclePayments)}</strong>
        </div>
        <div class="breakdown-row">
          <span>Saldo pendiente</span>
          <strong>${formatCurrency(client.amountDue)}</strong>
        </div>
      `;
    }

    if (historyTable) {
      const history = getPaymentHistory(client);

      if (history.length === 0) {
        historyTable.innerHTML = `
          <tr>
            <td colspan="6">
              <div class="empty-state">Aun no hay pagos registrados para esta factura.</div>
            </td>
          </tr>
        `;
      } else {
        historyTable.innerHTML = history.map((payment) => `
          <tr>
            <td>${escapeHtml(formatDate(payment.paidAt.slice(0, 10)))}</td>
            <td>${escapeHtml(payment.service)}</td>
            <td>${escapeHtml(payment.cardMasked)}</td>
            <td>${formatCurrency(payment.amount)}</td>
            <td><span class="status-tag status-green">Aprobado</span></td>
            <td>${renderReceiptActions(payment.id, true)}</td>
          </tr>
        `).join("");
      }
    }

    if (latestReceiptBox) {
      const latestPayment = getPaymentHistory(client)[0];

      if (!latestPayment) {
        latestReceiptBox.innerHTML = `<div class="empty-state">Cuando registres pagos aqui aparecera el comprobante mas reciente.</div>`;
      } else {
        latestReceiptBox.innerHTML = `
          <div class="breakdown-row">
            <span>Pago mas reciente</span>
            <strong>${formatCurrency(latestPayment.amount)}</strong>
          </div>
          <div class="breakdown-row">
            <span>Fecha de emision</span>
            <strong>${escapeHtml(formatDateTime(latestPayment.paidAt))}</strong>
          </div>
          <div class="breakdown-row">
            <span>Tarjeta utilizada</span>
            <strong>${escapeHtml(latestPayment.cardMasked)}</strong>
          </div>
          ${renderReceiptActions(latestPayment.id)}
        `;
      }
    }

    renderUserChart(client);
  }

  function renderProfilePage(client) {
    currentClientData = client;
    profileState.pendingPhotoDataUrl = null;
    profileState.removePhoto = false;

    const paymentHistory = getPaymentHistory(client);
    const totalPaid = paymentHistory.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const lastPaymentDate = paymentHistory[0]
      ? formatDate(paymentHistory[0].paidAt.slice(0, 10))
      : "Sin pagos";
    const dueText = client.dueDate
      ? `Vence el ${formatDate(client.dueDate)}`
      : "Vencimiento pendiente de definir";
    const accountState =
      client.amountDue > 0
        ? `Tu cuenta de ${client.service} mantiene un saldo pendiente de ${formatCurrency(client.amountDue)}.`
        : `Tu cuenta de ${client.service} se encuentra al dia y sin pagos pendientes.`;

    setText("[data-user-name]", client.name);
    setText("[data-user-email]", client.email);
    setText("[data-user-initials]", getInitials(client.name));
    setAvatarDisplay(getInitials(client.name), client.profilePhoto);
    setText("[data-user-chip]", `${client.service} activo`);
    setText("[data-user-service-label]", client.service);
    setText("[data-user-supply]", client.supplyCode);
    setText("[data-user-due-date]", dueText);
    setText("[data-user-total-due]", formatCurrency(client.amountDue));
    setText("[data-user-last-payment]", formatCurrency(client.lastPayment));
    setText("[data-user-payments]", String(client.completedPayments));
    setText("[data-user-account-status]", accountState);
    setStatusBadge("[data-user-status]", client.status);

    setText(
      "[data-profile-member-since]",
      client.createdAt ? formatDate(client.createdAt.slice(0, 10)) : "Sin registro"
    );
    setText("[data-profile-document]", displayOrFallback(client.documentId));
    setText("[data-profile-phone]", displayOrFallback(client.phone));
    setText("[data-profile-city]", displayOrFallback(client.city));
    setText("[data-profile-address]", displayOrFallback(client.address));
    setText("[data-profile-security-state]", "Protegida con contrasena");
    setText(
      "[data-profile-updated]",
      client.updatedAt ? formatDateTime(client.updatedAt) : "Sin cambios"
    );
    setText("[data-profile-last-payment-date]", lastPaymentDate);
    setText("[data-profile-total-history]", formatCurrency(totalPaid));
    setText(
      "[data-profile-reminder]",
      client.amountDue > 0
        ? `Tu servicio ${client.service} vence ${formatDate(client.dueDate)} y aun registra ${formatCurrency(client.amountDue)} pendientes.`
        : `Tu servicio ${client.service} no registra deudas pendientes en este momento.`
    );

    setInputValue("profileName", client.name);
    setInputValue("profileEmail", client.email);
    setInputValue("profilePhone", client.phone);
    setInputValue("profileDocument", client.documentId);
    setInputValue("profileCity", client.city);
    setInputValue("profileAddress", client.address);
    setInputValue("profilePassword", "");
    setInputValue("profilePhoto", "");

    renderServicesList(client);
    renderUserChart(client);
  }

  function luhnCheck(cardNumber) {
    const digits = String(cardNumber).replace(/\D/g, "");
    let sum = 0;
    let shouldDouble = false;

    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let digit = Number(digits[i]);

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
  }

  function normalizeCardNumber(value) {
    const digits = value.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
  }

  function normalizeExpiry(value) {
    const digits = value.replace(/\D/g, "").slice(0, 4);

    if (digits.length <= 2) {
      return digits;
    }

    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  function isValidExpiry(value) {
    if (!/^\d{2}\/\d{2}$/.test(value)) {
      return false;
    }

    const month = Number(value.slice(0, 2));
    const year = Number(`20${value.slice(3)}`);

    if (month < 1 || month > 12) {
      return false;
    }

    const now = new Date();
    const expiry = new Date(year, month, 0, 23, 59, 59);
    return expiry >= now;
  }

  function setupPaymentShortcuts() {
    const cardNumberInput = document.getElementById("cardNumber");
    const cardExpiryInput = document.getElementById("cardExpiry");
    const cardCvvInput = document.getElementById("cardCvv");
    const amountInput = document.getElementById("paymentAmount");
    const paymentForm = document.getElementById("paymentForm");

    if (cardNumberInput) {
      cardNumberInput.addEventListener("input", () => {
        cardNumberInput.value = normalizeCardNumber(cardNumberInput.value);
      });
    }

    if (cardExpiryInput) {
      cardExpiryInput.addEventListener("input", () => {
        cardExpiryInput.value = normalizeExpiry(cardExpiryInput.value);
      });
    }

    if (cardCvvInput) {
      cardCvvInput.addEventListener("input", () => {
        cardCvvInput.value = cardCvvInput.value.replace(/\D/g, "").slice(0, 4);
      });
    }

    document.addEventListener("click", async (event) => {
      const payButton = event.target.closest("[data-open-payment]");

      if (!payButton) {
        return;
      }

      event.preventDefault();

      if (paymentForm) {
        paymentForm.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      const session = getSession();
      if (!session || session.role !== "user") {
        return;
      }

      const client = await getClientById(session.clientId);
      if (client && amountInput) {
        amountInput.value = client.amountDue > 0 ? Number(client.amountDue).toFixed(2) : "";
      }
    });
  }

  function setupPaymentForm() {
    const paymentForm = document.getElementById("paymentForm");
    const feedback = document.getElementById("paymentFeedback");
    const submitButton = document.getElementById("paymentSubmitBtn");

    if (!paymentForm || paymentForm.dataset.bound === "true") {
      return;
    }

    paymentForm.dataset.bound = "true";

    paymentForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const session = getSession();

      if (!session || session.role !== "user") {
        goToLogin();
        return;
      }

      const cardHolder = document.getElementById("cardHolder").value.trim();
      const cardNumber = document.getElementById("cardNumber").value.trim();
      const cardExpiry = document.getElementById("cardExpiry").value.trim();
      const cardCvv = document.getElementById("cardCvv").value.trim();
      const paymentAmount = Number(document.getElementById("paymentAmount").value);

      if (!cardHolder || !cardNumber || !cardExpiry || !cardCvv) {
        feedback.textContent = "Completa todos los datos de la tarjeta para procesar el pago.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (!luhnCheck(cardNumber)) {
        feedback.textContent = "El numero de tarjeta ficticio no es valido. Prueba con 4242 4242 4242 4242.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (!isValidExpiry(cardExpiry)) {
        feedback.textContent = "La fecha de expiracion no es valida o ya vencio.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (!/^\d{3,4}$/.test(cardCvv)) {
        feedback.textContent = "El CVV debe tener 3 o 4 digitos.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (Number.isNaN(paymentAmount) || paymentAmount <= 0) {
        feedback.textContent = "Ingresa un monto de pago valido.";
        feedback.className = "admin-feedback error";
        return;
      }

      submitButton.disabled = true;

      try {
        const result = await processClientPayment(session.clientId, {
          cardHolder,
          cardNumber,
          amount: paymentAmount,
        });

        feedback.textContent = `Pago aprobado por ${formatCurrency(result.payment.amount)} con la tarjeta ${result.payment.cardMasked}.`;
        feedback.className = "admin-feedback success";
        paymentForm.reset();
        await renderUserDashboard(session);
      } catch (error) {
        feedback.textContent =
          error.message === "INVALID_PAYMENT_AMOUNT"
            ? "No se pudo procesar el pago porque el monto es invalido."
            : error.message === "NO_PENDING_BALANCE"
              ? "Tu cuenta ya no tiene saldo pendiente por pagar."
              : error.message === "PAYMENT_EXCEEDS_BALANCE"
                ? "El monto excede el saldo pendiente actual."
                : "No se pudo procesar el pago. Intenta nuevamente.";
        feedback.className = "admin-feedback error";
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.session);
    sessionStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem(STORAGE_KEYS.selectedRole);
  }

  function goToLogin() {
    window.location.replace("login.html");
  }

  function setupProfileForm() {
    const form = document.getElementById("profileForm");
    const feedback = document.getElementById("profileFeedback");
    const submitButton = document.getElementById("profileSubmitBtn");
    const photoInput = document.getElementById("profilePhoto");
    const removePhotoButton = document.getElementById("removeProfilePhotoBtn");
    const nameInput = document.getElementById("profileName");

    if (!form || form.dataset.bound === "true") {
      return;
    }

    form.dataset.bound = "true";

    if (nameInput) {
      nameInput.addEventListener("input", () => {
        const previewPhoto =
          profileState.pendingPhotoDataUrl !== null
            ? profileState.pendingPhotoDataUrl
            : currentClientData?.profilePhoto || "";
        setAvatarDisplay(getInitials(nameInput.value.trim() || "Cliente"), previewPhoto);
      });
    }

    if (photoInput) {
      photoInput.addEventListener("change", async () => {
        const selectedFile = photoInput.files && photoInput.files[0];

        if (!selectedFile) {
          profileState.pendingPhotoDataUrl = null;
          return;
        }

        if (!selectedFile.type.startsWith("image/")) {
          feedback.textContent = "Selecciona un archivo de imagen valido para la foto de perfil.";
          feedback.className = "admin-feedback error";
          photoInput.value = "";
          return;
        }

        if (selectedFile.size > 1024 * 1024 * 2) {
          feedback.textContent = "La foto debe pesar menos de 2 MB.";
          feedback.className = "admin-feedback error";
          photoInput.value = "";
          return;
        }

        try {
          const photoDataUrl = await readFileAsDataUrl(selectedFile);
          profileState.pendingPhotoDataUrl = photoDataUrl;
          profileState.removePhoto = false;

          const previewClient = currentClientData
            ? Object.assign({}, currentClientData, { profilePhoto: photoDataUrl })
            : null;

          if (previewClient) {
            setAvatarDisplay(getInitials(previewClient.name), previewClient.profilePhoto);
          }

          feedback.textContent = "Foto cargada correctamente. Guarda el perfil para conservarla.";
          feedback.className = "admin-feedback success";
        } catch (error) {
          feedback.textContent = "No se pudo leer la foto seleccionada.";
          feedback.className = "admin-feedback error";
        }
      });
    }

    if (removePhotoButton) {
      removePhotoButton.addEventListener("click", () => {
        profileState.pendingPhotoDataUrl = "";
        profileState.removePhoto = true;
        setInputValue("profilePhoto", "");
        setAvatarDisplay(
          getInitials(document.getElementById("profileName").value.trim() || currentClientData?.name || "Cliente"),
          ""
        );
        feedback.textContent = "La foto actual se quitara cuando guardes el perfil.";
        feedback.className = "admin-feedback success";
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const session = getSession();

      if (!session || session.role !== "user") {
        goToLogin();
        return;
      }

      const name = document.getElementById("profileName").value.trim();
      const email = document.getElementById("profileEmail").value.trim().toLowerCase();
      const phone = document.getElementById("profilePhone").value.trim();
      const documentId = document.getElementById("profileDocument").value.trim();
      const city = document.getElementById("profileCity").value.trim();
      const address = document.getElementById("profileAddress").value.trim();
      const password = document.getElementById("profilePassword").value.trim();
      const profilePhoto =
        profileState.pendingPhotoDataUrl !== null
          ? profileState.pendingPhotoDataUrl
          : currentClientData?.profilePhoto || "";

      if (!name || !email) {
        feedback.textContent = "Completa al menos el nombre y el correo para guardar el perfil.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (!email.includes("@") || !email.includes(".")) {
        feedback.textContent = "Ingresa un correo valido para la cuenta.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (password && password.length < 6) {
        feedback.textContent = "La nueva contrasena debe tener al menos 6 caracteres.";
        feedback.className = "admin-feedback error";
        return;
      }

      submitButton.disabled = true;

      try {
        const updatedClient = await updateClientProfile(session.clientId, {
          name,
          email,
          phone,
          documentId,
          city,
          address,
          password,
          profilePhoto: profileState.removePhoto ? "" : profilePhoto,
        });

        saveSession(Object.assign({}, session, {
          name: updatedClient.name,
          email: updatedClient.email,
        }));

        feedback.textContent = "Perfil actualizado correctamente. Tus nuevos datos ya quedaron guardados.";
        feedback.className = "admin-feedback success";
        renderProfilePage(updatedClient);
      } catch (error) {
        feedback.textContent =
          error.message === "EMAIL_EXISTS"
            ? "Ese correo ya esta en uso por otro cliente."
            : "No se pudo actualizar el perfil. Intenta nuevamente.";
        feedback.className = "admin-feedback error";
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function setAdminMode(isEditing) {
    const title = document.getElementById("clientFormTitle");
    const text = document.getElementById("clientFormText");
    const submitButton = document.getElementById("clientSubmitBtn");
    const cancelButton = document.getElementById("cancelEditBtn");
    const passwordInput = document.getElementById("clientPassword");
    const passwordHint = document.getElementById("clientPasswordHint");

    if (!title || !text || !submitButton || !cancelButton || !passwordInput || !passwordHint) {
      return;
    }

    if (isEditing) {
      title.textContent = "Editar cliente";
      text.textContent = "Actualiza la informacion del cliente. Si dejas la contrasena vacia, se mantiene la actual.";
      submitButton.textContent = "Actualizar cliente";
      cancelButton.classList.remove("hidden-btn");
      passwordInput.required = false;
      passwordInput.placeholder = "Nueva contrasena opcional";
      passwordHint.textContent = "Deja este campo vacio si no deseas cambiar la contrasena actual.";
      return;
    }

    title.textContent = "Registrar nuevo cliente";
    text.textContent = "Crea cuentas reales para que luego puedan iniciar sesion con su propio correo y contrasena.";
    submitButton.textContent = "Guardar cliente";
    cancelButton.classList.add("hidden-btn");
    passwordInput.required = true;
    passwordInput.placeholder = "Clave del cliente";
    passwordHint.textContent = "Define una contrasena segura para el nuevo cliente.";
  }

  function resetAdminForm() {
    const form = document.getElementById("clientForm");
    const feedback = document.getElementById("clientFeedback");
    const hiddenId = document.getElementById("clientId");

    if (form) {
      form.reset();
    }

    if (hiddenId) {
      hiddenId.value = "";
    }

    if (feedback) {
      feedback.textContent = "";
      feedback.className = "admin-feedback";
    }

    adminState.editingId = null;
    setAdminMode(false);
  }

  async function renderAdminDashboard() {
    const admin = await getAdminProfile();
    const clients = await getClients();
    const tableBody = document.getElementById("clientsTableBody");
    const { totalDue, overdueClients, activeClients, activeServices } = getAdminMetrics(clients);

    if (admin) {
      setText("[data-user-name]", admin.name);
      setText("[data-user-email]", admin.email);
      setText("[data-admin-initials]", getInitials(admin.name));
    }

    setText("[data-admin-revenue]", formatCurrency(totalDue));
    setText("[data-admin-clients]", String(activeClients));
    setText("[data-admin-total-due]", formatCurrency(totalDue));
    setText("[data-admin-active]", String(activeClients));
    setText("[data-admin-active-badge]", String(activeClients));
    setText("[data-admin-overdue]", String(overdueClients));
    setText("[data-admin-overdue-badge]", String(overdueClients));
    setText("[data-admin-services]", String(activeServices));
    setText(
      "[data-admin-summary]",
      activeClients > 0
        ? `Actualmente tienes ${activeClients} clientes registrados y una cartera total de ${formatCurrency(totalDue)}.`
        : "Todavia no hay clientes registrados. Crea la primera cuenta para activar la operacion."
    );
    setText(
      "[data-admin-chip]",
      activeClients > 0 ? `${activeClients} clientes en control` : "Control central"
    );
    setText(
      "[data-admin-risk-text]",
      overdueClients > 0
        ? `${overdueClients} cuentas acumulan valores vencidos y requieren seguimiento.`
        : "No hay cuentas vencidas en este momento."
    );

    adminState.reviewedNotificationIds = getAdminNotificationState();
    renderAdminNotifications(buildAdminNotifications(admin || { email: "", supportEmail: "" }, clients));

    if (!tableBody) {
      return;
    }

    if (clients.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              Todavia no hay clientes registrados. Usa el formulario para crear la primera cuenta.
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = clients
      .map((client) => {
        return `
          <tr>
            <td>
              <strong>${escapeHtml(client.name)}</strong><br>
              <small>${escapeHtml(client.email)}</small>
            </td>
            <td>${escapeHtml(client.service)}</td>
            <td>${formatCurrency(client.amountDue)}</td>
            <td><span class="status-tag ${getStatusClass(client.status)}">${escapeHtml(client.status)}</span></td>
            <td>
              <div class="table-actions">
                <button class="ghost-btn compact-btn" type="button" data-edit-client="${escapeHtml(client.id)}">Editar</button>
                <button class="ghost-btn compact-btn danger-btn" type="button" data-delete-client="${escapeHtml(client.id)}">Eliminar</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function renderAdminSettingsPage() {
    const admin = await getAdminProfile();
    const clients = await getClients();
    const { totalDue, overdueClients, activeClients, activeServices } = getAdminMetrics(clients);

    if (!admin) {
      clearSession();
      goToLogin();
      return;
    }

    setAdminIdentity(admin);
    setText("[data-admin-total-due]", formatCurrency(totalDue));
    setText("[data-admin-clients]", String(activeClients));
    setText("[data-admin-overdue]", String(overdueClients));
    setText("[data-admin-overdue-badge]", String(overdueClients));
    setText("[data-admin-services]", String(activeServices));
    setText("[data-admin-support-email]", admin.supportEmail);
    setText("[data-admin-phone-display]", displayOrFallback(admin.phone));
    setText("[data-admin-position-display]", displayOrFallback(admin.position, "Administrador general"));
    setText("[data-admin-created-at]", admin.createdAt ? formatDate(admin.createdAt.slice(0, 10)) : "Sin registro");
    setText("[data-admin-updated-at]", admin.updatedAt ? formatDateTime(admin.updatedAt) : "Sin cambios");
    setText(
      "[data-admin-settings-summary]",
      activeClients > 0
        ? `Controlas ${activeClients} clientes, ${activeServices} servicios y una cartera total de ${formatCurrency(totalDue)}.`
        : "Aun no hay clientes registrados. La cuenta administrativa ya esta lista para iniciar la operacion."
    );

    setInputValue("adminName", admin.name);
    setInputValue("adminEmail", admin.email);
    setInputValue("adminPhone", admin.phone);
    setInputValue("adminPosition", admin.position);
    setInputValue("adminSupportEmail", admin.supportEmail);
    setInputValue("adminCurrentPassword", "");
    setInputValue("adminNewPassword", "");
  }

  async function fillAdminForm(clientId) {
    const client = await getClientById(clientId);

    if (!client) {
      return;
    }

    adminState.editingId = client.id;
    document.getElementById("clientId").value = client.id;
    document.getElementById("clientName").value = client.name;
    document.getElementById("clientEmail").value = client.email;
    document.getElementById("clientPassword").value = "";
    document.getElementById("clientService").value = client.service;
    document.getElementById("clientAmount").value = client.amountDue;
    document.getElementById("clientDueDate").value = client.dueDate;
    setAdminMode(true);
  }

  function setupAdminActions() {
    const form = document.getElementById("clientForm");
    const feedback = document.getElementById("clientFeedback");
    const cancelButton = document.getElementById("cancelEditBtn");

    if (!form || form.dataset.bound === "true") {
      return;
    }

    form.dataset.bound = "true";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const name = document.getElementById("clientName").value.trim();
      const email = document.getElementById("clientEmail").value.trim().toLowerCase();
      const password = document.getElementById("clientPassword").value.trim();
      const service = document.getElementById("clientService").value;
      const amountValue = document.getElementById("clientAmount").value.trim();
      const amountDue = Number(amountValue);
      const dueDate = document.getElementById("clientDueDate").value;
      const isEditing = Boolean(adminState.editingId);

      if (!name || !email || !service || !dueDate || amountValue === "") {
        feedback.textContent = "Completa todos los campos para guardar el cliente.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (!isEditing && !password) {
        feedback.textContent = "Debes definir una contrasena para el nuevo cliente.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (password && password.length < 6) {
        feedback.textContent = "La contrasena debe tener al menos 6 caracteres.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (Number.isNaN(amountDue) || amountDue < 0) {
        feedback.textContent = "Ingresa un monto pendiente valido.";
        feedback.className = "admin-feedback error";
        return;
      }

      try {
        if (isEditing) {
          await updateClient(adminState.editingId, {
            name,
            email,
            password,
            service,
            amountDue,
            dueDate,
          });
        } else {
          await createClient({
            name,
            email,
            password,
            service,
            amountDue,
            dueDate,
          });
        }

        resetAdminForm();
        feedback.textContent = isEditing
          ? "Cliente actualizado correctamente."
          : "Cliente registrado correctamente. Ya puede iniciar sesion.";
        feedback.className = "admin-feedback success";
        await renderAdminDashboard();
      } catch (error) {
        feedback.textContent =
          error.message === "EMAIL_EXISTS"
            ? "Ese correo ya esta registrado para otro cliente."
            : "No se pudo guardar el cliente. Intenta nuevamente.";
        feedback.className = "admin-feedback error";
      }
    });

    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        resetAdminForm();
      });
    }

    document.addEventListener("click", async (event) => {
      const editButton = event.target.closest("[data-edit-client]");
      const deleteButton = event.target.closest("[data-delete-client]");

      if (editButton) {
        await fillAdminForm(editButton.dataset.editClient);
        return;
      }

      if (deleteButton) {
        const clientId = deleteButton.dataset.deleteClient;
        const confirmed = window.confirm("Quieres eliminar este cliente de la base de datos?");

        if (!confirmed) {
          return;
        }

        try {
          await deleteClient(clientId);

          if (adminState.editingId === clientId) {
            resetAdminForm();
          }

          await renderAdminDashboard();
        } catch (error) {
          feedback.textContent = "No se pudo eliminar el cliente.";
          feedback.className = "admin-feedback error";
        }
      }
    });
  }

  function setupAdminSettingsForm() {
    const form = document.getElementById("adminSettingsForm");
    const feedback = document.getElementById("adminSettingsFeedback");
    const submitButton = document.getElementById("adminSettingsSubmitBtn");

    if (!form || form.dataset.bound === "true") {
      return;
    }

    form.dataset.bound = "true";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const session = getSession();

      if (!session || session.role !== "admin") {
        goToLogin();
        return;
      }

      const name = document.getElementById("adminName").value.trim();
      const email = document.getElementById("adminEmail").value.trim().toLowerCase();
      const phone = document.getElementById("adminPhone").value.trim();
      const position = document.getElementById("adminPosition").value.trim();
      const supportEmail = document.getElementById("adminSupportEmail").value.trim().toLowerCase();
      const currentPassword = document.getElementById("adminCurrentPassword").value.trim();
      const newPassword = document.getElementById("adminNewPassword").value.trim();

      if (!name || !email || !currentPassword) {
        feedback.textContent = "Completa nombre, correo y contrasena actual para guardar la configuracion.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (!email.includes("@") || !email.includes(".")) {
        feedback.textContent = "Ingresa un correo administrativo valido.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (supportEmail && (!supportEmail.includes("@") || !supportEmail.includes("."))) {
        feedback.textContent = "El correo de soporte no es valido.";
        feedback.className = "admin-feedback error";
        return;
      }

      if (newPassword && newPassword.length < 6) {
        feedback.textContent = "La nueva contrasena debe tener al menos 6 caracteres.";
        feedback.className = "admin-feedback error";
        return;
      }

      submitButton.disabled = true;

      try {
        const updatedAdmin = await updateAdminSettings({
          name,
          email,
          phone,
          position,
          supportEmail,
          currentPassword,
          newPassword,
        });

        saveSession({
          role: "admin",
          name: updatedAdmin.name,
          email: updatedAdmin.email,
        });

        feedback.textContent = "Configuracion administrativa actualizada correctamente.";
        feedback.className = "admin-feedback success";
        await renderAdminSettingsPage();
      } catch (error) {
        feedback.textContent =
          error.message === "CURRENT_PASSWORD_REQUIRED"
            ? "Debes escribir la contrasena actual para confirmar los cambios."
            : error.message === "CURRENT_PASSWORD_INVALID"
              ? "La contrasena actual no es correcta."
              : error.message === "INVALID_PASSWORD"
                ? "La nueva contrasena no cumple con el minimo requerido."
                : "No se pudo guardar la configuracion del administrador.";
        feedback.className = "admin-feedback error";
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  async function renderUserDashboard(session) {
    const activeClient = await getClientById(session.clientId);

    if (!activeClient) {
      clearSession();
      goToLogin();
      return;
    }

    currentClientData = activeClient;

    const initials = getInitials(activeClient.name);
    const dueText = activeClient.dueDate
      ? `Vence el ${formatDate(activeClient.dueDate)}`
      : "Vencimiento pendiente de definir";
    const accountState =
      activeClient.amountDue > 0
        ? `Tu servicio ${activeClient.service} tiene un saldo pendiente de ${formatCurrency(activeClient.amountDue)}.`
        : `Tu cuenta de ${activeClient.service} se encuentra al dia.`;

    setText("[data-user-name]", activeClient.name);
    setText("[data-user-email]", activeClient.email);
    setText("[data-user-initials]", initials);
    setAvatarDisplay(initials, activeClient.profilePhoto);
    setText("[data-user-chip]", `${activeClient.service} activo`);
    setText("[data-user-total-due]", formatCurrency(activeClient.amountDue));
    setText("[data-user-payments]", String(activeClient.completedPayments));
    setText("[data-user-discount]", `${activeClient.discount}%`);
    setText("[data-user-service-label]", activeClient.service);
    setStatusBadge("[data-user-status]", activeClient.status);
    setText("[data-user-main-amount]", formatCurrency(activeClient.amountDue));
    setText("[data-user-due-date]", dueText);
    setText("[data-user-supply]", activeClient.supplyCode);
    setText("[data-user-last-payment]", formatCurrency(activeClient.lastPayment));
    setText("[data-user-alerts]", "00");
    setText("[data-user-account-status]", accountState);
    setText(
      "[data-user-reminder]",
      `${activeClient.service} tiene vencimiento programado para ${formatDate(activeClient.dueDate)}.`
    );

    renderServicesList(activeClient);

    const paymentList = document.querySelector("[data-user-payment-list]");
    if (paymentList) {
      if (activeClient.amountDue > 0) {
        paymentList.innerHTML = `
          <div class="payment-item">
            <div class="icon-pill ${getServiceIconClass(activeClient.service)}">
              ${escapeHtml(activeClient.service.toUpperCase().slice(0, 4))}
            </div>
            <div>
              <strong>${escapeHtml(activeClient.service)}</strong>
              <p>${escapeHtml(activeClient.supplyCode)} | ${escapeHtml(dueText)}</p>
            </div>
            <div>
              <div class="amount">${formatCurrency(activeClient.amountDue)}</div>
              <button class="ghost-btn" type="button" data-open-payment>Pagar</button>
            </div>
          </div>
        `;
      } else {
        paymentList.innerHTML = `
          <div class="empty-state">
            No tienes pagos pendientes en este momento. Tu cuenta se encuentra al dia.
          </div>
        `;
      }
    }

    const amountInput = document.getElementById("paymentAmount");
    if (amountInput && !amountInput.dataset.dirty) {
      amountInput.value = activeClient.amountDue > 0 ? Number(activeClient.amountDue).toFixed(2) : "";
    }

    renderUserChart(activeClient);
    renderUserHistory(activeClient);
  }

  function setupCommonActions() {
    logoutButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearSession();
        goToLogin();
      });
    });

    document.addEventListener("click", (event) => {
      const logoutButton = event.target.closest("[data-logout]");
      const receiptButton = event.target.closest("[data-download-receipt]");
      const pdfButton = event.target.closest("[data-export-pdf]");
      const printButton = event.target.closest("[data-print-receipt]");
      const readUserNotificationButton = event.target.closest("[data-read-user-notification]");
      const resetUserNotificationsButton = event.target.closest("[data-reset-user-notifications]");
      const reviewNotificationButton = event.target.closest("[data-review-notification]");
      const unreviewNotificationButton = event.target.closest("[data-unreview-notification]");
      const resetNotificationsButton = event.target.closest("[data-reset-admin-notifications]");

      if (readUserNotificationButton && currentClientData) {
        const notificationId = readUserNotificationButton.dataset.readUserNotification;

        if (!userState.reviewedNotificationIds.includes(notificationId)) {
          userState.reviewedNotificationIds = userState.reviewedNotificationIds.concat(notificationId);
          saveUserNotificationState(currentClientData.id, userState.reviewedNotificationIds);
          renderUserNotifications(currentClientData, userState.notifications);
        }

        return;
      }

      if (resetUserNotificationsButton && currentClientData) {
        userState.reviewedNotificationIds = [];
        saveUserNotificationState(currentClientData.id, []);
        renderUserNotifications(currentClientData, userState.notifications);
        return;
      }

      if (reviewNotificationButton) {
        const notificationId = reviewNotificationButton.dataset.reviewNotification;

        if (!adminState.reviewedNotificationIds.includes(notificationId)) {
          adminState.reviewedNotificationIds = adminState.reviewedNotificationIds.concat(notificationId);
          saveAdminNotificationState(adminState.reviewedNotificationIds);
          renderAdminNotifications(adminState.notifications);
        }

        return;
      }

      if (unreviewNotificationButton) {
        const notificationId = unreviewNotificationButton.dataset.unreviewNotification;
        adminState.reviewedNotificationIds = adminState.reviewedNotificationIds.filter((id) => id !== notificationId);
        saveAdminNotificationState(adminState.reviewedNotificationIds);
        renderAdminNotifications(adminState.notifications);
        return;
      }

      if (resetNotificationsButton) {
        adminState.reviewedNotificationIds = [];
        saveAdminNotificationState([]);
        renderAdminNotifications(adminState.notifications);
        return;
      }

      if (receiptButton || pdfButton || printButton) {
        const paymentId =
          receiptButton?.dataset.downloadReceipt ||
          pdfButton?.dataset.exportPdf ||
          printButton?.dataset.printReceipt;
        const payment = currentClientData ? findPaymentById(currentClientData, paymentId) : null;

        if (payment && currentClientData) {
          if (receiptButton) {
            downloadReceipt(currentClientData, payment);
          }

          if (pdfButton) {
            openReceiptWindow(currentClientData, payment, {
              autoPrint: true,
              pdfMode: true,
            });
          }

          if (printButton) {
            openReceiptWindow(currentClientData, payment, {
              autoPrint: true,
              pdfMode: false,
            });
          }
        }

        return;
      }

      if (logoutButton) {
        event.preventDefault();
        clearSession();
        goToLogin();
        return;
      }

      const button = event.target.closest("[data-demo-action]");

      if (!button) {
        return;
      }

      const target = button.dataset.demoAction;
      const originalText = button.textContent;
      const messages = {
        pay: "Flujo de pago listo para integrar con pasarela.",
        report: "Reporte preparado para exportacion PDF o Excel.",
        alert: "Centro de alertas activado para este modulo.",
        client: "Ficha de cliente lista para abrir en el siguiente paso.",
      };

      button.textContent = "Listo";

      window.setTimeout(() => {
        button.textContent = messages[target] || originalText;
      }, 250);
    });
  }

  function startDashboard() {
    const session = getSession();
    const pageView = document.body.dataset.page || "dashboard";

    if (!session || session.role !== pageRole) {
      goToLogin();
      return;
    }

    if (welcomeName) {
      setText("[data-user-name]", session.name);
    }

    if (welcomeEmail) {
      setText("[data-user-email]", session.email);
    }

    if (welcomeRole) {
      setText("[data-role-label]", roleLabels[pageRole]);
    }

    setupCommonActions();

    if (pageRole === "admin") {
      if (pageView === "settings") {
        setupAdminSettingsForm();
        renderAdminSettingsPage();
      } else {
        setupAdminActions();
        setAdminMode(false);
        renderAdminDashboard();
      }
    }

    if (pageRole === "user") {
      if (pageView === "invoices") {
        getClientById(session.clientId).then((client) => {
          if (!client) {
            clearSession();
            goToLogin();
            return;
          }

          currentClientData = client;

          const dueText = client.dueDate
            ? `Vence el ${formatDate(client.dueDate)}`
            : "Vencimiento pendiente de definir";
          const accountState =
            client.amountDue > 0
              ? `Tu factura actual de ${client.service} mantiene un saldo pendiente de ${formatCurrency(client.amountDue)}.`
              : `La factura actual de ${client.service} se encuentra completamente pagada.`;

          setText("[data-user-name]", client.name);
          setText("[data-user-email]", client.email);
          setText("[data-user-initials]", getInitials(client.name));
          setAvatarDisplay(getInitials(client.name), client.profilePhoto);
          setText("[data-user-chip]", `${client.service} activo`);
          setText("[data-user-service-label]", client.service);
          setStatusBadge("[data-user-status]", client.status);
          setText("[data-user-supply]", client.supplyCode);
          setText("[data-user-due-date]", dueText);
          setText("[data-user-account-status]", accountState);
          renderServicesList(client);

          renderInvoicePage(client);
        });
      } else if (pageView === "profile") {
        setupProfileForm();
        getClientById(session.clientId).then((client) => {
          if (!client) {
            clearSession();
            goToLogin();
            return;
          }

          renderProfilePage(client);
        });
      } else {
        setupPaymentShortcuts();
        setupPaymentForm();
        renderUserDashboard(session);
      }
    }
  }

  initializeDatabase().then(startDashboard);
})();
