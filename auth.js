(() => {
  "use strict";

  const CONFIG = Object.freeze({
    region: "us-east-2",
    clientId: "63738r9gpr126qpgp1a5cubchi",
    cognitoEndpoint: "https://cognito-idp.us-east-2.amazonaws.com/",
    apiBase: "https://zmumi2wruk.execute-api.us-east-2.amazonaws.com",
    sessionKey: "anox:auth:v1"
  });

  const auth = {
    mode: "login",
    pendingEmail: "",
    session: readSession(),
    user: null,
    orders: [],
    busy: false,
    message: "",
    messageKind: ""
  };

  const isArabic = () =>
    (document.documentElement.lang || "ar")
      .toLowerCase()
      .startsWith("ar");

  const t = (ar, en) => isArabic() ? ar : en;

  const $ = id => document.getElementById(id);

  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[ch]
    );

  function readSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.sessionKey);

      if (!raw) return null;

      const parsed = JSON.parse(raw);

      if (
        !parsed ||
        typeof parsed !== "object" ||
        !parsed.idToken ||
        !parsed.refreshToken
      ) return null;

      return parsed;

    } catch {
      return null;
    }
  }

  function writeSession(session) {
    auth.session = session;

    if (session) {
      sessionStorage.setItem(
        CONFIG.sessionKey,
        JSON.stringify(session)
      );
    } else {
      sessionStorage.removeItem(CONFIG.sessionKey);
    }
  }

  function normalizeEmail(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function isAccountRoute() {
    const raw = (location.hash || "#home").slice(1);

    return raw.split("?", 1)[0] === "account";
  }

  function setMessage(message = "", kind = "") {
    auth.message = message;
    auth.messageKind = kind;
  }

  function friendlyError(error) {
    const code =
      error?.code ||
      error?.name ||
      error?.error ||
      "";

    const map = {
      UsernameExistsException:
        t(
          "يوجد حساب بهذا البريد بالفعل.",
          "An account with this email already exists."
        ),

      CodeMismatchException:
        t(
          "رمز التحقق غير صحيح.",
          "The verification code is incorrect."
        ),

      ExpiredCodeException:
        t(
          "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.",
          "The code expired. Request a new one."
        ),

      NotAuthorizedException:
        t(
          "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
          "Email or password is incorrect."
        ),

      UserNotFoundException:
        t(
          "لم نجد حسابًا بهذا البريد.",
          "No account was found for this email."
        ),

      UserNotConfirmedException:
        t(
          "يجب تأكيد البريد الإلكتروني أولًا.",
          "Verify your email first."
        ),

      InvalidPasswordException:
        t(
          "كلمة المرور لا تستوفي المتطلبات.",
          "The password does not meet the requirements."
        ),

      LimitExceededException:
        t(
          "تم تجاوز الحد المؤقت للمحاولات. حاول لاحقًا.",
          "Too many attempts. Try again later."
        ),

      TooManyRequestsException:
        t(
          "محاولات كثيرة جدًا. حاول بعد قليل.",
          "Too many requests. Try again shortly."
        ),

      PasswordResetRequiredException:
        t(
          "يتطلب الحساب إعادة تعيين كلمة المرور.",
          "This account requires a password reset."
        ),

      VERIFIED_EMAIL_REQUIRED:
        t(
          "يجب أن يكون البريد الإلكتروني مؤكدًا لربط الطلب.",
          "A verified email is required to link this order."
        ),

      ORDER_NOT_FOUND:
        t(
          "لم نجد هذا الطلب.",
          "Order not found."
        ),

      ORDER_EMAIL_MISMATCH:
        t(
          "بريد الطلب لا يطابق بريد هذا الحساب.",
          "The order email does not match this account."
        ),

      ORDER_ALREADY_LINKED:
        t(
          "هذا الطلب مرتبط بحساب آخر.",
          "This order is already linked to another account."
        ),

      UNAUTHORIZED:
        t(
          "انتهت الجلسة. سجّل الدخول من جديد.",
          "Your session expired. Sign in again."
        ),

      INVALID_DISPLAY_NAME:
        t(
          "اسم العرض غير صالح.",
          "The display name is invalid."
        )
    };

    return (
      map[code] ||
      t(
        "تعذر إكمال العملية. حاول مرة أخرى.",
        "The request could not be completed. Try again."
      )
    );
  }

  async function cognito(target, body) {
    const response = await fetch(
      CONFIG.cognitoEndpoint,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target":
            `AWSCognitoIdentityProviderService.${target}`
        },

        body: JSON.stringify(body),

        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const type = String(
        data.__type ||
        data.code ||
        ""
      ).split("#").pop();

      const err = new Error(
        data.message ||
        type ||
        `HTTP ${response.status}`
      );

      err.code =
        type ||
        `HTTP_${response.status}`;

      throw err;
    }

    return data;
  }

  function sessionFromAuthentication(
    result,
    priorRefreshToken = ""
  ) {
    const a = result?.AuthenticationResult;

    if (!a?.IdToken || !a?.AccessToken) {
      throw Object.assign(
        new Error("Missing authentication tokens"),
        { code: "INVALID_AUTH_RESPONSE" }
      );
    }

    return {
      idToken: a.IdToken,
      accessToken: a.AccessToken,

      refreshToken:
        a.RefreshToken ||
        priorRefreshToken,

      expiresAt:
        Date.now() +
        Math.max(
          60,
          Number(a.ExpiresIn || 3600)
        ) * 1000 -
        30000
    };
  }

  async function refreshSession() {
    const current = auth.session;

    if (!current?.refreshToken) {
      throw Object.assign(
        new Error("No refresh token"),
        { code: "UNAUTHORIZED" }
      );
    }

    const result = await cognito(
      "InitiateAuth",
      {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: CONFIG.clientId,

        AuthParameters: {
          REFRESH_TOKEN:
            current.refreshToken
        }
      }
    );

    const next =
      sessionFromAuthentication(
        result,
        current.refreshToken
      );

    writeSession(next);

    return next;
  }

  async function validSession() {
    if (!auth.session) return null;

    if (
      Number(auth.session.expiresAt || 0) >
      Date.now() + 15000
    ) {
      return auth.session;
    }

    try {
      return await refreshSession();

    } catch {
      signOut(false);

      return null;
    }
  }

  async function api(
    path,
    options = {},
    retry = true
  ) {
    const session =
      await validSession();

    if (!session?.idToken) {
      throw Object.assign(
        new Error("Not signed in"),
        { code: "UNAUTHORIZED" }
      );
    }

    const headers =
      new Headers(
        options.headers || {}
      );

    headers.set(
      "Authorization",
      `Bearer ${session.idToken}`
    );

    if (
      options.body !== undefined &&
      !headers.has("Content-Type")
    ) {
      headers.set(
        "Content-Type",
        "application/json"
      );
    }

    const response = await fetch(
      `${CONFIG.apiBase}${path}`,
      {
        ...options,
        headers,

        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      }
    );

    if (
      response.status === 401 &&
      retry &&
      auth.session?.refreshToken
    ) {
      await refreshSession();

      return api(
        path,
        options,
        false
      );
    }

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        data.error ||
        `HTTP ${response.status}`
      );

      err.code =
        data.error ||
        `HTTP_${response.status}`;

      throw err;
    }

    return data;
  }

  function pageShell(
    title,
    intro,
    body
  ) {
    return `
      <div
        class="page route-enter"
        data-anox-auth-root
      >
        <div class="container">

          <div class="page-heading">
            <div>

              <span class="eyebrow">
                ANOX ACCOUNT
              </span>

              <h1>
                ${esc(title)}
              </h1>

              <p>
                ${esc(intro)}
              </p>

            </div>
          </div>

          ${body}

        </div>
      </div>
    `;
  }

  function notice() {
    if (!auth.message) return "";

    const cls =
      auth.messageKind === "error"
        ? "warning"
        : auth.messageKind === "success"
        ? "success"
        : "";

    return `
      <div
        class="notice ${cls}"
        role="status"
        style="margin-bottom:20px"
      >
        <span>
          ${esc(auth.message)}
        </span>
      </div>
    `;
  }

  function field({
    name,
    label,
    type = "text",
    autocomplete = "off",
    required = false,
    value = "",
    extra = ""
  }) {
    return `
      <div class="field">

        <label for="auth-${esc(name)}">
          ${esc(label)}
        </label>

        <input
          class="input"
          id="auth-${esc(name)}"
          name="${esc(name)}"
          type="${esc(type)}"
          autocomplete="${esc(autocomplete)}"
          ${required ? "required" : ""}
          value="${esc(value)}"
          ${extra}
        >

      </div>
    `;
  }

  function authTabs() {
    return `
      <div
        class="actions"
        style="margin-bottom:24px"
      >

        <button
          type="button"
          class="btn ${
            auth.mode === "login"
              ? "primary"
              : "secondary"
          }"
          data-auth-action="mode-login"
        >
          ${esc(
            t(
              "تسجيل الدخول",
              "Sign in"
            )
          )}
        </button>

        <button
          type="button"
          class="btn ${
            auth.mode === "signup"
              ? "primary"
              : "secondary"
          }"
          data-auth-action="mode-signup"
        >
          ${esc(
            t(
              "إنشاء حساب",
              "Create account"
            )
          )}
        </button>

      </div>
    `;
  }

  function signedOutMarkup() {
    let form;

    if (auth.mode === "signup") {

      form = `
        <form
          class="surface"
          data-anox-auth-form
          id="anox-auth-signup"
          novalidate
        >

          <h2
            style="
              font-size:1.4rem;
              margin-bottom:18px
            "
          >
            ${esc(
              t(
                "إنشاء حساب AnoX",
                "Create your AnoX account"
              )
            )}
          </h2>

          <div class="form-grid">

            ${field({
              name: "email",
              label:
                t(
                  "البريد الإلكتروني",
                  "Email"
                ),
              type: "email",
              autocomplete: "email",
              required: true,
              extra:
                'maxlength="160" dir="ltr"'
            })}

            ${field({
              name: "password",
              label:
                t(
                  "كلمة المرور",
                  "Password"
                ),
              type: "password",
              autocomplete:
                "new-password",
              required: true,
              extra:
                'minlength="10" maxlength="128" dir="ltr"'
            })}

          </div>

          <p
            class="fine"
            style="margin-top:14px"
          >
            ${esc(
              t(
                "10 أحرف على الأقل، وتتضمن حرفًا كبيرًا وحرفًا صغيرًا ورقمًا.",
                "Use at least 10 characters with uppercase, lowercase, and a number."
              )
            )}
          </p>

          <div
            class="actions actions-spaced"
          >
            <button
              class="btn primary"
              type="submit"
            >
              ${esc(
                t(
                  "إنشاء الحساب",
                  "Create account"
                )
              )}
            </button>
          </div>

        </form>
      `;

    } else if (
      auth.mode === "confirm"
    ) {

      form = `
        <form
          class="surface"
          data-anox-auth-form
          id="anox-auth-confirm"
          novalidate
        >

          <h2
            style="
              font-size:1.4rem;
              margin-bottom:10px
            "
          >
            ${esc(
              t(
                "تأكيد البريد الإلكتروني",
                "Verify your email"
              )
            )}
          </h2>

          <p
            class="fine"
            style="margin-bottom:18px"
          >
            ${esc(
              t(
                "أدخل الرمز الذي أرسلناه إلى بريدك.",
                "Enter the code sent to your email."
              )
            )}
          </p>

          <div class="form-grid">

            ${field({
              name: "email",
              label:
                t(
                  "البريد الإلكتروني",
                  "Email"
                ),
              type: "email",
              autocomplete: "email",
              required: true,
              value:
                auth.pendingEmail,
              extra:
                'maxlength="160" dir="ltr"'
            })}

            ${field({
              name: "code",
              label:
                t(
                  "رمز التحقق",
                  "Verification code"
                ),
              type: "text",
              autocomplete:
                "one-time-code",
              required: true,
              extra:
                'inputmode="numeric" maxlength="12" dir="ltr"'
            })}

          </div>

          <div
            class="actions actions-spaced"
          >

            <button
              class="btn primary"
              type="submit"
            >
              ${esc(
                t(
                  "تأكيد",
                  "Verify"
                )
              )}
            </button>

            <button
              class="text-btn"
              type="button"
              data-auth-action="resend"
            >
              ${esc(
                t(
                  "إرسال رمز جديد",
                  "Resend code"
                )
              )}
            </button>

          </div>

        </form>
      `;

    } else {

      form = `
        <form
          class="surface"
          data-anox-auth-form
          id="anox-auth-login"
          novalidate
        >

          <h2
            style="
              font-size:1.4rem;
              margin-bottom:18px
            "
          >
            ${esc(
              t(
                "مرحبًا بعودتك",
                "Welcome back"
              )
            )}
          </h2>

          <div class="form-grid">

            ${field({
              name: "email",
              label:
                t(
                  "البريد الإلكتروني",
                  "Email"
                ),
              type: "email",
              autocomplete: "email",
              required: true,
              value:
                auth.pendingEmail,
              extra:
                'maxlength="160" dir="ltr"'
            })}

            ${field({
              name: "password",
              label:
                t(
                  "كلمة المرور",
                  "Password"
                ),
              type: "password",
              autocomplete:
                "current-password",
              required: true,
              extra:
                'maxlength="128" dir="ltr"'
            })}

          </div>

          <div
            class="actions actions-spaced"
          >
            <button
              class="btn primary"
              type="submit"
            >
              ${esc(
                t(
                  "تسجيل الدخول",
                  "Sign in"
                )
              )}
            </button>
          </div>

        </form>
      `;
    }

    return pageShell(
      t(
        "حسابك في AnoX",
        "Your AnoX account"
      ),

      t(
        "سجّل الدخول لمزامنة حسابك وطلباتك مع خوادم AnoX.",
        "Sign in to access your AnoX account and server-side orders."
      ),

      `
        ${notice()}

        ${
          auth.mode === "confirm"
            ? ""
            : authTabs()
        }

        ${form}

        <div
          class="notice"
          style="margin-top:22px"
        >
          <span>
            ${esc(
              t(
                "كلمة المرور لا تُحفظ في التخزين المحلي. جلسة تسجيل الدخول تبقى في هذه علامة التبويب فقط.",
                "Your password is never stored locally. The signed-in session stays in this browser tab only."
              )
            )}
          </span>
        </div>
      `
    );
  }

  function orderAmount(order) {
    if (
      Number.isFinite(
        order?.amountTotal
      ) &&
      order.currency
    ) {
      try {
        return new Intl.NumberFormat(
          isArabic()
            ? "ar-DZ"
            : "en-US",

          {
            style: "currency",
            currency:
              String(
                order.currency
              ).toUpperCase()
          }
        ).format(
          order.amountTotal / 100
        );

      } catch {}
    }

    return "—";
  }

  function orderDate(value) {
    const d = new Date(
      value || ""
    );

    if (
      Number.isNaN(
        d.getTime()
      )
    ) {
      return "";
    }

    return new Intl.DateTimeFormat(
      isArabic()
        ? "ar-DZ"
        : "en-US",

      {
        dateStyle: "medium",
        timeStyle: "short"
      }
    ).format(d);
  }

  function ordersMarkup() {
    if (!auth.orders.length) {
      return `
        <div class="empty">

          <h3>
            ${esc(
              t(
                "لا توجد طلبات مرتبطة بالحساب بعد",
                "No orders are linked to this account yet"
              )
            )}
          </h3>

          <p>
            ${esc(
              t(
                "يمكنك ربط طلب سابق أدناه إذا استُخدم فيه البريد نفسه.",
                "You can link an earlier order below if it used the same email address."
              )
            )}
          </p>

        </div>
      `;
    }

    return auth.orders
      .map(
        order => `
          <article
            class="order-card"
          >

            <div>

              <h3
                class="order-id"
                dir="ltr"
              >
                ${esc(
                  order.orderId
                )}
              </h3>

              <p>
                ${esc(
                  orderDate(
                    order.createdAt
                  )
                )}
              </p>

              <span
                class="pill"
                style="margin-top:10px"
              >
                ${esc(
                  order.paymentStatus ||
                  order.status ||
                  t(
                    "طلب",
                    "Order"
                  )
                )}
              </span>

            </div>

            <div
              class="order-card-end"
            >

              <strong>
                <bdi>
                  ${esc(
                    orderAmount(
                      order
                    )
                  )}
                </bdi>
              </strong>

            </div>

          </article>
        `
      )
      .join("");
  }

  function signedInMarkup() {
    const user =
      auth.user || {};

    const name =
      user.displayName ||
      user.email ||
      t(
        "عميل AnoX",
        "AnoX customer"
      );

    return pageShell(
      t(
        `أهلًا، ${name}`,
        `Hello, ${name}`
      ),

      t(
        "حساب موثّق ومتصل ببيانات AnoX على AWS.",
        "An authenticated account connected to AnoX data on AWS."
      ),

      `
        ${notice()}

        <div class="account-layout">

          <nav
            class="account-nav"
            aria-label="${esc(
              t(
                "روابط الحساب",
                "Account links"
              )
            )}"
          >

            <a
              href="#account"
              data-auth-section="profile"
            >
              ${esc(
                t(
                  "الملف الشخصي",
                  "Profile"
                )
              )}
            </a>

            <a
              href="#account"
              data-auth-section="orders"
            >
              ${esc(
                t(
                  "طلباتي",
                  "My orders"
                )
              )}
            </a>

            <a
              href="#settings"
              data-nav
            >
              ${esc(
                t(
                  "الإعدادات",
                  "Settings"
                )
              )}
            </a>

            <button
              type="button"
              data-auth-action="logout"
            >
              ${esc(
                t(
                  "تسجيل الخروج",
                  "Sign out"
                )
              )}
            </button>

          </nav>

          <div>

            <section
              class="surface"
              id="auth-account-profile"
              tabindex="-1"
            >

              <h2
                style="
                  font-size:1.4rem;
                  margin-bottom:8px
                "
              >
                ${esc(
                  t(
                    "الملف الشخصي",
                    "Profile"
                  )
                )}
              </h2>

              <p
                class="fine"
                dir="auto"
                style="margin-bottom:18px"
              >
                ${esc(
                  user.email || ""
                )}
              </p>

              <form
                class="profile-form"
                data-anox-auth-form
                id="anox-auth-profile"
                novalidate
              >

                ${field({
                  name:
                    "displayName",

                  label:
                    t(
                      "اسم العرض",
                      "Display name"
                    ),

                  autocomplete:
                    "nickname",

                  required: true,

                  value:
                    user.displayName ||
                    "",

                  extra:
                    'maxlength="80"'
                })}

                <button
                  class="btn primary"
                  type="submit"
                >
                  ${esc(
                    t(
                      "حفظ",
                      "Save"
                    )
                  )}
                </button>

              </form>

            </section>

            <section
              class="account-section"
              id="auth-account-orders"
              tabindex="-1"
            >

              <h2>
                ${esc(
                  t(
                    "الطلبات",
                    "Orders"
                  )
                )}
              </h2>

              ${ordersMarkup()}

            </section>

            <section
              class="surface"
              style="margin-top:30px"
            >

              <h2
                style="
                  font-size:1.3rem;
                  margin-bottom:10px
                "
              >
                ${esc(
                  t(
                    "ربط طلب سابق",
                    "Link an earlier order"
                  )
                )}
              </h2>

              <p
                class="fine"
                style="margin-bottom:18px"
              >
                ${esc(
                  t(
                    "استخدم رقم طلب تم إنشاؤه بالبريد الإلكتروني نفسه.",
                    "Use an order ID created with the same email address."
                  )
                )}
              </p>

              <form
                data-anox-auth-form
                id="anox-auth-link-order"
                novalidate
              >

                <div class="form-grid">

                  ${field({
                    name:
                      "orderId",

                    label:
                      t(
                        "رقم الطلب",
                        "Order ID"
                      ),

                    required: true,

                    extra:
                      'maxlength="120" dir="ltr"'
                  })}

                </div>

                <div
                  class="actions actions-spaced"
                >

                  <button
                    class="btn secondary"
                    type="submit"
                  >
                    ${esc(
                      t(
                        "ربط الطلب",
                        "Link order"
                      )
                    )}
                  </button>

                </div>

              </form>

            </section>

          </div>

        </div>
      `
    );
  }

  function render() {
    if (!isAccountRoute()) {
      return;
    }

    const main =
      $("main");

    if (!main) {
      return;
    }

    main.innerHTML =
      auth.session
        ? signedInMarkup()
        : signedOutMarkup();

    main.setAttribute(
      "aria-busy",
      auth.busy
        ? "true"
        : "false"
    );
  }

  async function loadAccount() {
    if (
      !auth.session ||
      !isAccountRoute()
    ) {
      return;
    }

    auth.busy = true;

    render();

    try {
      const [me, orders] =
        await Promise.all([
          api("/me"),
          api("/orders")
        ]);

      auth.user =
        me.user || null;

      auth.orders =
        Array.isArray(
          orders.orders
        )
          ? orders.orders
          : [];

      setMessage();

    } catch (error) {

      if (
        (error?.code || "") ===
        "UNAUTHORIZED"
      ) {
        signOut(false);

      } else {
        setMessage(
          friendlyError(error),
          "error"
        );
      }

    } finally {
      auth.busy = false;

      render();
    }
  }

  async function signIn(
    email,
    password
  ) {
    const result =
      await cognito(
        "InitiateAuth",
        {
          AuthFlow:
            "USER_PASSWORD_AUTH",

          ClientId:
            CONFIG.clientId,

          AuthParameters: {
            USERNAME:
              email,

            PASSWORD:
              password
          }
        }
      );

    if (
      result.ChallengeName
    ) {
      throw Object.assign(
        new Error(
          result.ChallengeName
        ),
        {
          code:
            "UNSUPPORTED_AUTH_CHALLENGE"
        }
      );
    }

    writeSession(
      sessionFromAuthentication(
        result
      )
    );

    auth.pendingEmail =
      email;

    auth.user = null;
    auth.orders = [];

    setMessage(
      t(
        "تم تسجيل الدخول.",
        "Signed in."
      ),
      "success"
    );

    await loadAccount();
  }

  function signOut(
    showMessage = true
  ) {
    writeSession(null);

    auth.user = null;
    auth.orders = [];

    auth.mode = "login";

    if (showMessage) {
      setMessage(
        t(
          "تم تسجيل الخروج.",
          "Signed out."
        ),
        "success"
      );
    }

    render();
  }

  async function handleSubmit(
    form
  ) {
    if (auth.busy) {
      return;
    }

    auth.busy = true;

    setMessage();

    render();

    try {
      const data =
        new FormData(form);

      if (
        form.id ===
        "anox-auth-signup"
      ) {
        const email =
          normalizeEmail(
            data.get("email")
          );

        const password =
          String(
            data.get(
              "password"
            ) || ""
          );

        await cognito(
          "SignUp",
          {
            ClientId:
              CONFIG.clientId,

            Username:
              email,

            Password:
              password,

            UserAttributes: [
              {
                Name:
                  "email",

                Value:
                  email
              }
            ]
          }
        );

        auth.pendingEmail =
          email;

        auth.mode =
          "confirm";

        setMessage(
          t(
            "أرسلنا رمز التحقق إلى بريدك.",
            "We sent a verification code to your email."
          ),
          "success"
        );

      } else if (
        form.id ===
        "anox-auth-confirm"
      ) {
        const email =
          normalizeEmail(
            data.get("email")
          );

        const code =
          String(
            data.get(
              "code"
            ) || ""
          ).trim();

        await cognito(
          "ConfirmSignUp",
          {
            ClientId:
              CONFIG.clientId,

            Username:
              email,

            ConfirmationCode:
              code
          }
        );

        auth.pendingEmail =
          email;

        auth.mode =
          "login";

        setMessage(
          t(
            "تم تأكيد البريد. يمكنك تسجيل الدخول الآن.",
            "Email verified. You can sign in now."
          ),
          "success"
        );

      } else if (
        form.id ===
        "anox-auth-login"
      ) {
        const email =
          normalizeEmail(
            data.get("email")
          );

        const password =
          String(
            data.get(
              "password"
            ) || ""
          );

        try {
          await signIn(
            email,
            password
          );

        } catch (error) {

          if (
            error?.code ===
            "UserNotConfirmedException"
          ) {
            auth.pendingEmail =
              email;

            auth.mode =
              "confirm";
          }

          throw error;
        }

      } else if (
        form.id ===
        "anox-auth-profile"
      ) {
        const displayName =
          String(
            data.get(
              "displayName"
            ) || ""
          ).trim();

        const result =
          await api(
            "/me",
            {
              method:
                "PUT",

              body:
                JSON.stringify({
                  displayName
                })
            }
          );

        auth.user =
          result.user ||
          auth.user;

        setMessage(
          t(
            "تم حفظ اسم العرض.",
            "Display name saved."
          ),
          "success"
        );

      } else if (
        form.id ===
        "anox-auth-link-order"
      ) {
        const orderId =
          String(
            data.get(
              "orderId"
            ) || ""
          ).trim();

        await api(
          `/orders/${encodeURIComponent(orderId)}/link`,
          {
            method: "POST"
          }
        );

        const orders =
          await api(
            "/orders"
          );

        auth.orders =
          Array.isArray(
            orders.orders
          )
            ? orders.orders
            : [];

        setMessage(
          t(
            "تم ربط الطلب بالحساب.",
            "Order linked to your account."
          ),
          "success"
        );
      }

    } catch (error) {

      setMessage(
        friendlyError(error),
        "error"
      );

    } finally {

      auth.busy = false;

      render();
    }
  }

  async function resendCode() {
    const email =
      normalizeEmail(
        auth.pendingEmail ||
        $("auth-email")?.value
      );

    if (!email) {
      setMessage(
        t(
          "أدخل بريدك الإلكتروني أولًا.",
          "Enter your email first."
        ),
        "error"
      );

      render();

      return;
    }

    auth.busy = true;

    render();

    try {
      await cognito(
        "ResendConfirmationCode",
        {
          ClientId:
            CONFIG.clientId,

          Username:
            email
        }
      );

      auth.pendingEmail =
        email;

      setMessage(
        t(
          "أرسلنا رمزًا جديدًا.",
          "A new verification code was sent."
        ),
        "success"
      );

    } catch (error) {

      setMessage(
        friendlyError(error),
        "error"
      );

    } finally {

      auth.busy = false;

      render();
    }
  }

  document.addEventListener(
    "submit",
    event => {
      const form =
        event.target;

      if (
        !(
          form instanceof
          HTMLFormElement
        ) ||
        !form.matches(
          "[data-anox-auth-form]"
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void handleSubmit(form);

    },
    true
  );

  for (
    const type of [
      "input",
      "change"
    ]
  ) {
    document.addEventListener(
      type,
      event => {
        if (
          event.target instanceof Element &&
          event.target.closest(
            "[data-anox-auth-form]"
          )
        ) {
          event.stopPropagation();
        }
      },
      true
    );
  }

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof Element
          ? event.target.closest(
              "[data-auth-action],[data-auth-section]"
            )
          : null;

      if (!target) {
        return;
      }

      if (
        target.matches(
          "[data-auth-section]"
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const section =
          target.dataset.authSection ===
          "orders"
            ? $("auth-account-orders")
            : $("auth-account-profile");

        section?.scrollIntoView({
          block: "start"
        });

        section?.focus({
          preventScroll: true
        });

        return;
      }

      const action =
        target.dataset.authAction;

      if (!action) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (
        action ===
        "mode-login"
      ) {
        auth.mode = "login";

        setMessage();

        render();

      } else if (
        action ===
        "mode-signup"
      ) {
        auth.mode = "signup";

        setMessage();

        render();

      } else if (
        action ===
        "logout"
      ) {
        signOut(true);

      } else if (
        action ===
        "resend"
      ) {
        void resendCode();
      }

    },
    true
  );

  let scheduled = false;

  const reconcile = () => {
    if (!isAccountRoute()) {
      return;
    }

    const main =
      $("main");

    if (!main) {
      return;
    }

    if (
      !main.querySelector(
        "[data-anox-auth-root]"
      )
    ) {
      render();

      if (
        auth.session &&
        !auth.user &&
        !auth.busy
      ) {
        void loadAccount();
      }
    }
  };

  const scheduleReconcile = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;

    queueMicrotask(() => {
      scheduled = false;

      reconcile();
    });
  };

  window.addEventListener(
    "hashchange",
    () => {
      scheduleReconcile();

      if (
        isAccountRoute() &&
        auth.session &&
        !auth.user &&
        !auth.busy
      ) {
        void loadAccount();
      }
    }
  );

  const observer =
    new MutationObserver(
      scheduleReconcile
    );

  const start = () => {
    const main =
      $("main");

    if (main) {
      observer.observe(
        main,
        {
          childList: true
        }
      );
    }

    reconcile();

    if (
      isAccountRoute() &&
      auth.session &&
      !auth.user &&
      !auth.busy
    ) {
      void loadAccount();
    }
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );

  } else {
    start();
  }

})();
