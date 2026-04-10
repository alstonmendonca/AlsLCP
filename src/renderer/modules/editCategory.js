const { ipcRenderer } = require("electron");
const  {createTextPopup} = require("./textPopup");

let catid;
let isActive = 1;

document.addEventListener("DOMContentLoaded", () => {
    const editCategoryNameInput = document.getElementById("editCategoryName");
    const toggleBtn = document.getElementById("toggleActive");
    const saveChangesBtn = document.getElementById("saveChangesBtn");
    const cancelEditBtn = document.getElementById("cancelEditBtn");
    const closeOverlay = document.querySelector(".close-overlay");
    const modal = document.querySelector(".modal");

    // This module is loaded on the main page, but its modal DOM exists only in the edit popup.
    if (!editCategoryNameInput || !toggleBtn || !saveChangesBtn || !cancelEditBtn || !closeOverlay || !modal) {
        return;
    }

    ipcRenderer.on("edit-category-data", (event, categoryData) => {
        catid = categoryData.catid;
        editCategoryNameInput.value = categoryData.catname;
        isActive = categoryData.active;

        toggleBtn.classList.toggle("active", isActive === 1);
        updateStatusLabel(); // Update label based on initial value

        closeOverlay.style.display = "block";
        modal.style.display = "block";
    });

    toggleBtn.addEventListener("click", function () {
        isActive = isActive === 1 ? 0 : 1;
        this.classList.toggle("active", isActive === 1);
        updateStatusLabel(); // Update label when toggled
    });

    saveChangesBtn.addEventListener("click", () => {
        const updatedName = editCategoryNameInput.value.trim();

        if (!updatedName) {
            createTextPopup("Please enter a category name.");
            return;
        }

        ipcRenderer.send("update-category", { catid, catname: updatedName, active: isActive });
    });

    ipcRenderer.on("category-updated", () => {
        closeModal();
    });

    cancelEditBtn.addEventListener("click", closeModal);
});

// Function to update the status label
function updateStatusLabel() {
    const statusLabel = document.getElementById("toggleStatusLabel");
    statusLabel.textContent = isActive === 1 ? "Active" : "Inactive";
    statusLabel.style.color = isActive === 1 ? "green" : "red";
}

function closeModal() {
    document.querySelector(".close-overlay").style.display = "none";
    document.querySelector(".modal").style.display = "none";
}
