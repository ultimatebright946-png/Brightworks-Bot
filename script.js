function showCommands() {
  const commands = document.getElementById("commands");
  const button = document.querySelector("button");

  if (commands.hidden) {
    commands.hidden = false;
    button.textContent = "Hide Commands";
  } else {
    commands.hidden = true;
    button.textContent = "View Commands";
  }
}

console.log("⚡ BrightWorks Bot website loaded!");
