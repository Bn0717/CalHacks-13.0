// Practice form: checks like a real site would (required fields, a 10-digit phone), then "sends" by showing a
// confirmation. Nothing leaves the page.
const form = document.getElementById("signup");
const $ = (n) => form.elements[n];
const show = (id, text) => { const e = document.getElementById(id); e.textContent = text; e.hidden = !text; };

document.getElementById("next").addEventListener("click", () => {
  const missing = ["first", "last", "email", "phone"].filter((n) => !$(n).value.trim());
  if (missing.length) return show("err1", "Please fill in every field.");
  if (!$("email").checkValidity()) return show("err1", "Please enter a valid email address.");
  const digits = $("phone").value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return show("err1", "Please enter a 10-digit phone number.");
  show("err1", "");
  document.getElementById("page1").hidden = true;
  document.getElementById("page2").hidden = false;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!$("class").value) return show("err2", "Please choose a class.");
  if (!form.querySelector("input[name=format]:checked")) return show("err2", "Please choose in person or online.");
  show("err2", "");
  const n = 40000 + Math.floor(Math.random() * 9999);
  form.hidden = true;
  document.getElementById("thanks").hidden = false;
  document.getElementById("thanks-title").textContent = `Thank you, ${$("first").value.trim()}! You're signed up.`;
  document.getElementById("thanks-text").textContent =
    `Class: ${$("class").value}. Joining: ${form.querySelector("input[name=format]:checked").value}. ` +
    `${$("largeprint").checked ? "Large-print handouts: yes. " : ""}Confirmation number MG-${n}. We sent the details to ${$("email").value.trim()}.`;
});
