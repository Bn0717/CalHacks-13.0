// Demo check-in form: shows "You're checked in" once the required boxes are filled and ticked. Nothing is sent anywhere.
(() => {
  const form = document.getElementById("checkin");
  const error = document.getElementById("error");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = form.querySelector("input[name=visit_type]:checked");
    const ok = form.name.value.trim() && form.appointment.value.trim() && type && document.getElementById("consent").checked;
    error.hidden = !!ok;
    if (!ok) return;
    form.hidden = true;
    document.getElementById("done").hidden = false;
    document.getElementById("done-type").textContent = type.parentElement.textContent.trim();
  });
})();
