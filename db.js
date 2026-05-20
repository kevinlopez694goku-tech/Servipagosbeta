(function () {
  const ADMIN_SEED = {
    name: "Ana Torres",
    email: "admin@servipagos.com",
    password: "Admin2026SP!",
  };

  const DB_NAME = "servipagos-db";
  const DB_VERSION = 1;
  const META_STORE = "meta";
  const CLIENTS_STORE = "clients";
  const FALLBACK_DB_KEY = "servipagos-fallback-db";

  function supportsIndexedDb() {
    return typeof window !== "undefined" && "indexedDB" in window;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }

        if (!database.objectStoreNames.contains(CLIENTS_STORE)) {
          const clientsStore = database.createObjectStore(CLIENTS_STORE, { keyPath: "id" });
          clientsStore.createIndex("email", "email", { unique: true });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getStore(database, storeName, mode) {
    return database.transaction(storeName, mode || "readonly").objectStore(storeName);
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function readFallbackDb() {
    const rawDatabase = localStorage.getItem(FALLBACK_DB_KEY);

    if (!rawDatabase) {
      return { meta: {}, clients: [] };
    }

    try {
      const parsedDatabase = JSON.parse(rawDatabase);
      return {
        meta: parsedDatabase.meta || {},
        clients: Array.isArray(parsedDatabase.clients) ? parsedDatabase.clients : [],
      };
    } catch (error) {
      return { meta: {}, clients: [] };
    }
  }

  function writeFallbackDb(database) {
    localStorage.setItem(FALLBACK_DB_KEY, JSON.stringify(database));
  }

  function sanitizeClient(client) {
    if (!client) {
      return null;
    }

    const safeClient = normalizeClientRecord(Object.assign({}, client));
    delete safeClient.passwordHash;
    delete safeClient.passwordSalt;
    return safeClient;
  }

  function normalizeAdminRecord(admin) {
    admin.name = admin.name || ADMIN_SEED.name;
    admin.email = (admin.email || ADMIN_SEED.email).toLowerCase();
    admin.phone = admin.phone || "";
    admin.position = admin.position || "Administrador general";
    admin.supportEmail = (admin.supportEmail || admin.email).toLowerCase();
    admin.createdAt = admin.createdAt || new Date().toISOString();
    admin.updatedAt = admin.updatedAt || admin.createdAt;
    return admin;
  }

  function sanitizeAdmin(admin) {
    if (!admin) {
      return null;
    }

    const safeAdmin = normalizeAdminRecord(Object.assign({}, admin));
    delete safeAdmin.passwordHash;
    delete safeAdmin.passwordSalt;
    return safeAdmin;
  }

  function normalizeClientRecord(client) {
    client.paymentHistory = Array.isArray(client.paymentHistory) ? client.paymentHistory : [];
    client.lastPayment = Number(client.lastPayment || 0);
    client.completedPayments = Number(client.completedPayments || 0);
    client.discount = Number(client.discount || 0);
    client.amountDue = Number(client.amountDue || 0);
    client.phone = client.phone || "";
    client.city = client.city || "";
    client.address = client.address || "";
    client.documentId = client.documentId || "";
    client.profilePhoto = client.profilePhoto || "";
    client.status = client.status || deriveStatus(client.amountDue);
    client.service = client.service || "Servicio basico";
    client.supplyCode = client.supplyCode || makeSupplyCode();
    return client;
  }

  function deriveStatus(amountDue) {
    if (amountDue > 50) {
      return "Vencido";
    }

    if (amountDue > 0) {
      return "Pendiente";
    }

    return "Al dia";
  }

  function makeSupplyCode() {
    return `SUM-${String(Date.now()).slice(-6)}`;
  }

  function makeId() {
    return `cli-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function makePaymentId() {
    return `pay-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  function makeSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  async function hashPassword(password, salt) {
    const payload = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", payload);
    return bytesToHex(new Uint8Array(digest));
  }

  async function getAdminRecord() {
    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const metaStore = getStore(database, META_STORE);
      const record = await requestToPromise(metaStore.get("admin"));
      database.close();
      return record ? normalizeAdminRecord(record) : null;
    }

    const admin = readFallbackDb().meta.admin || null;
    return admin ? normalizeAdminRecord(admin) : null;
  }

  async function ensureAdminSeed() {
    const adminRecord = await getAdminRecord();

    if (adminRecord) {
      return;
    }

    const salt = makeSalt();
    const passwordHash = await hashPassword(ADMIN_SEED.password, salt);
    const record = {
      key: "admin",
      name: ADMIN_SEED.name,
      email: ADMIN_SEED.email.toLowerCase(),
      passwordHash,
      passwordSalt: salt,
      phone: "",
      position: "Administrador general",
      supportEmail: ADMIN_SEED.email.toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const metaStore = getStore(database, META_STORE, "readwrite");
      await requestToPromise(metaStore.put(record));
      database.close();
      return;
    }

    const fallbackDb = readFallbackDb();
    fallbackDb.meta.admin = record;
    writeFallbackDb(fallbackDb);
  }

  async function getClientRecordByEmail(email) {
    const normalizedEmail = email.trim().toLowerCase();

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE);
      const emailIndex = clientsStore.index("email");
      const client = await requestToPromise(emailIndex.get(normalizedEmail));
      database.close();
      return client || null;
    }

    return readFallbackDb().clients.find((client) => client.email === normalizedEmail) || null;
  }

  async function getClientRecordById(id) {
    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE);
      const client = await requestToPromise(clientsStore.get(id));
      database.close();
      return client || null;
    }

    return readFallbackDb().clients.find((client) => client.id === id) || null;
  }

  async function initializeDatabase() {
    await ensureAdminSeed();
  }

  async function verifyAdminCredentials(email, password) {
    const admin = await getAdminRecord();

    if (!admin) {
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const candidateHash = await hashPassword(password, admin.passwordSalt);

    if (normalizedEmail !== admin.email || candidateHash !== admin.passwordHash) {
      return null;
    }

    return {
      name: admin.name,
      email: admin.email,
    };
  }

  async function getAdminProfile() {
    const admin = await getAdminRecord();
    return sanitizeAdmin(admin);
  }

  async function updateAdminSettings(payload) {
    const admin = await getAdminRecord();

    if (!admin) {
      throw new Error("ADMIN_NOT_FOUND");
    }

    const currentPassword = (payload.currentPassword || "").trim();

    if (!currentPassword) {
      throw new Error("CURRENT_PASSWORD_REQUIRED");
    }

    const currentHash = await hashPassword(currentPassword, admin.passwordSalt);

    if (currentHash !== admin.passwordHash) {
      throw new Error("CURRENT_PASSWORD_INVALID");
    }

    const newPassword = (payload.newPassword || "").trim();

    if (newPassword && newPassword.length < 6) {
      throw new Error("INVALID_PASSWORD");
    }

    const updatedAdmin = normalizeAdminRecord(Object.assign({}, admin, {
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: (payload.phone || "").trim(),
      position: (payload.position || "").trim() || "Administrador general",
      supportEmail: (payload.supportEmail || payload.email || admin.email).trim().toLowerCase(),
      updatedAt: new Date().toISOString(),
    }));

    if (newPassword) {
      const salt = makeSalt();
      updatedAdmin.passwordSalt = salt;
      updatedAdmin.passwordHash = await hashPassword(newPassword, salt);
    }

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const metaStore = getStore(database, META_STORE, "readwrite");
      await requestToPromise(metaStore.put(updatedAdmin));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.meta.admin = updatedAdmin;
      writeFallbackDb(fallbackDb);
    }

    return sanitizeAdmin(updatedAdmin);
  }

  async function getClients() {
    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE);
      const allClients = await requestToPromise(clientsStore.getAll());
      database.close();

      return allClients
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map(sanitizeClient);
    }

    return readFallbackDb()
      .clients
      .slice()
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .map(sanitizeClient);
  }

  async function countClients() {
    const clients = await getClients();
    return clients.length;
  }

  async function getClientById(id) {
    const client = await getClientRecordById(id);
    return sanitizeClient(client);
  }

  async function verifyClientCredentials(email, password) {
    const client = await getClientRecordByEmail(email);

    if (!client) {
      return null;
    }

    const candidateHash = await hashPassword(password, client.passwordSalt);

    if (candidateHash !== client.passwordHash) {
      return null;
    }

    return sanitizeClient(client);
  }

  async function recoverClientPassword(payload) {
    const normalizedEmail = payload.email.trim().toLowerCase();
    const supplyCode = payload.supplyCode.trim().toUpperCase();
    const documentId = (payload.documentId || "").trim();
    const newPassword = (payload.newPassword || "").trim();
    const client = await getClientRecordByEmail(normalizedEmail);

    if (!client) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    if (client.supplyCode.trim().toUpperCase() !== supplyCode) {
      throw new Error("INVALID_SUPPLY_CODE");
    }

    if (client.documentId && !documentId) {
      throw new Error("DOCUMENT_REQUIRED");
    }

    if (client.documentId && client.documentId.trim() !== documentId) {
      throw new Error("DOCUMENT_MISMATCH");
    }

    if (newPassword.length < 6) {
      throw new Error("INVALID_PASSWORD");
    }

    const updatedClient = Object.assign({}, client, {
      updatedAt: new Date().toISOString(),
    });
    const salt = makeSalt();

    updatedClient.passwordSalt = salt;
    updatedClient.passwordHash = await hashPassword(newPassword, salt);

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE, "readwrite");
      await requestToPromise(clientsStore.put(updatedClient));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.clients = fallbackDb.clients.map((item) =>
        item.id === updatedClient.id ? updatedClient : item
      );
      writeFallbackDb(fallbackDb);
    }

    return sanitizeClient(updatedClient);
  }

  async function createClient(payload) {
    const existingClient = await getClientRecordByEmail(payload.email);

    if (existingClient) {
      throw new Error("EMAIL_EXISTS");
    }

    const salt = makeSalt();
    const passwordHash = await hashPassword(payload.password, salt);
    const now = new Date().toISOString();
    const amountDue = Number(payload.amountDue || 0);
    const record = {
      id: makeId(),
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      passwordHash,
      passwordSalt: salt,
      service: payload.service,
      amountDue,
      dueDate: payload.dueDate,
      status: deriveStatus(amountDue),
      supplyCode: makeSupplyCode(),
      lastPayment: amountDue > 0 ? 0 : 25,
      completedPayments: amountDue > 0 ? 0 : 1,
      discount: amountDue > 0 ? 0 : 5,
      phone: "",
      city: "",
      address: "",
      documentId: "",
      profilePhoto: "",
      paymentHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE, "readwrite");
      await requestToPromise(clientsStore.add(record));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.clients.unshift(record);
      writeFallbackDb(fallbackDb);
    }

    return sanitizeClient(record);
  }

  async function updateClient(id, payload) {
    const existingClient = await getClientRecordById(id);

    if (!existingClient) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const clientWithEmail = await getClientRecordByEmail(normalizedEmail);

    if (clientWithEmail && clientWithEmail.id !== id) {
      throw new Error("EMAIL_EXISTS");
    }

    const amountDue = Number(payload.amountDue || 0);
    const updatedClient = Object.assign({}, existingClient, {
      name: payload.name.trim(),
      email: normalizedEmail,
      service: payload.service,
      amountDue,
      dueDate: payload.dueDate,
      status: deriveStatus(amountDue),
      discount: amountDue > 0 ? 0 : 5,
      updatedAt: new Date().toISOString(),
    });
    normalizeClientRecord(updatedClient);

    if (payload.password && payload.password.trim()) {
      const salt = makeSalt();
      updatedClient.passwordSalt = salt;
      updatedClient.passwordHash = await hashPassword(payload.password.trim(), salt);
    }

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE, "readwrite");
      await requestToPromise(clientsStore.put(updatedClient));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.clients = fallbackDb.clients.map((client) =>
        client.id === id ? updatedClient : client
      );
      writeFallbackDb(fallbackDb);
    }

    return sanitizeClient(updatedClient);
  }

  async function updateClientProfile(id, payload) {
    const existingClient = await getClientRecordById(id);

    if (!existingClient) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const clientWithEmail = await getClientRecordByEmail(normalizedEmail);

    if (clientWithEmail && clientWithEmail.id !== id) {
      throw new Error("EMAIL_EXISTS");
    }

    const updatedClient = Object.assign({}, existingClient, {
      name: payload.name.trim(),
      email: normalizedEmail,
      phone: (payload.phone || "").trim(),
      city: (payload.city || "").trim(),
      address: (payload.address || "").trim(),
      documentId: (payload.documentId || "").trim(),
      profilePhoto:
        typeof payload.profilePhoto === "string"
          ? payload.profilePhoto
          : existingClient.profilePhoto || "",
      updatedAt: new Date().toISOString(),
    });
    normalizeClientRecord(updatedClient);

    if (payload.password && payload.password.trim()) {
      const salt = makeSalt();
      updatedClient.passwordSalt = salt;
      updatedClient.passwordHash = await hashPassword(payload.password.trim(), salt);
    }

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE, "readwrite");
      await requestToPromise(clientsStore.put(updatedClient));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.clients = fallbackDb.clients.map((client) =>
        client.id === id ? updatedClient : client
      );
      writeFallbackDb(fallbackDb);
    }

    return sanitizeClient(updatedClient);
  }

  async function deleteClient(id) {
    const existingClient = await getClientRecordById(id);

    if (!existingClient) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE, "readwrite");
      await requestToPromise(clientsStore.delete(id));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.clients = fallbackDb.clients.filter((client) => client.id !== id);
      writeFallbackDb(fallbackDb);
    }
  }

  function maskCardNumber(cardNumber) {
    const digits = String(cardNumber).replace(/\D/g, "");
    const lastDigits = digits.slice(-4);
    return `**** **** **** ${lastDigits}`;
  }

  async function processClientPayment(id, payload) {
    const existingClient = await getClientRecordById(id);

    if (!existingClient) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    const client = normalizeClientRecord(Object.assign({}, existingClient));
    const paymentAmount = Number(payload.amount);

    if (Number(client.amountDue) <= 0) {
      throw new Error("NO_PENDING_BALANCE");
    }

    if (Number.isNaN(paymentAmount) || paymentAmount <= 0) {
      throw new Error("INVALID_PAYMENT_AMOUNT");
    }

    if (paymentAmount > Number(client.amountDue)) {
      throw new Error("PAYMENT_EXCEEDS_BALANCE");
    }

    const now = new Date();
    const remainingBalance = Math.max(0, Number(client.amountDue) - paymentAmount);
    const paymentRecord = {
      id: makePaymentId(),
      amount: Number(paymentAmount.toFixed(2)),
      cardHolder: payload.cardHolder.trim(),
      cardMasked: maskCardNumber(payload.cardNumber),
      service: client.service,
      paidAt: now.toISOString(),
      monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    };

    client.paymentHistory = [paymentRecord].concat(client.paymentHistory || []);
    client.amountDue = Number(remainingBalance.toFixed(2));
    client.lastPayment = paymentRecord.amount;
    client.completedPayments = Number(client.completedPayments || 0) + 1;
    client.discount = client.amountDue === 0 ? 5 : 0;
    client.status = deriveStatus(client.amountDue);
    client.updatedAt = now.toISOString();

    if (supportsIndexedDb()) {
      const database = await openDatabase();
      const clientsStore = getStore(database, CLIENTS_STORE, "readwrite");
      await requestToPromise(clientsStore.put(client));
      database.close();
    } else {
      const fallbackDb = readFallbackDb();
      fallbackDb.clients = fallbackDb.clients.map((item) => (item.id === id ? client : item));
      writeFallbackDb(fallbackDb);
    }

    return {
      client: sanitizeClient(client),
      payment: paymentRecord,
    };
  }

  window.ServiPagosDB = {
    ADMIN_SEED,
    initializeDatabase,
    verifyAdminCredentials,
    getAdminProfile,
    updateAdminSettings,
    getClients,
    countClients,
    getClientById,
    verifyClientCredentials,
    recoverClientPassword,
    createClient,
    updateClient,
    updateClientProfile,
    deleteClient,
    processClientPayment,
  };
})();
