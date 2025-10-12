let currentSlide = 0;
const slides = document.querySelectorAll('.slides');
const slideshowWrapper = document.querySelector('.slideshow-wrapper');
const totalSlides = slides.length; 
let slideInterval;

function updateSlidePosition() {
    slideshowWrapper.style.transform = `translateX(${-currentSlide * 100}%)`;
}

function startAutoSlide() {
    // Clear any existing interval before starting a new one
    clearInterval(slideInterval);
    slideInterval = setInterval(() => changeSlide(1, false), 5000); // Auto-scroll every 5 seconds
}

function changeSlide(n, isManual = true) {
    if (isManual) {
        // Stop and restart the auto-slide timer only on manual click
        clearInterval(slideInterval); 
    }
    
    // Calculate the new slide index and wrap around (0, 1, 2, 0, 1, 2...)
    currentSlide = (currentSlide + n % totalSlides + totalSlides) % totalSlides;
    updateSlidePosition();

    if (isManual) {
        startAutoSlide(); // Restart the timer after a manual change
    }
}

// Responsive navbar toggle (used by the hamburger button)
function toggleMenu() {
    const navbar = document.getElementById("navbar");
    if (window.innerWidth <= 800) {
         // Toggle visibility on mobile
         navbar.style.display = navbar.style.display === "block" ? "none" : "block";
    }
}

// Ensure navbar reappears when resizing to desktop view
window.addEventListener('resize', () => {
    const navbar = document.getElementById("navbar");
    if (window.innerWidth > 800) {
        navbar.style.display = "flex"; 
    } else {
        // Hide the navbar when resizing down to mobile, just in case it was stuck open
        navbar.style.display = "none";
    }
});

// Initialize the first slide position and start auto-sliding on page load
updateSlidePosition();
startAutoSlide();
