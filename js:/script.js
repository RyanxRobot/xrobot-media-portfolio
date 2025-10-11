
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slides');
        const slideshowWrapper = document.querySelector('.slideshow-wrapper');

        function updateSlidePosition() {
            slideshowWrapper.style.transform = `translateX(${-currentSlide * 100}%)`;
        }

        function changeSlide(n) {
            currentSlide = (currentSlide + n + slides.length) % slides.length;
            updateSlidePosition();
        }

        setInterval(() => changeSlide(1), 5000); // Automatically move to next slide every 5 seconds

        // Responsive navbar toggle
        function toggleMenu() {
            const navbar = document.getElementById("navbar");
            if (navbar.style.display === "block") {
                navbar.style.display = "none";
            } else {
                navbar.style.display = "block";
            }
        }

        // Ensure navbar reappears when resizing to desktop view
        window.addEventListener('resize', () => {
            const navbar = document.getElementById("navbar");
            if (window.innerWidth > 800) {
                navbar.style.display = "block";
            }
        });

        // Initialize the first slide position
        updateSlidePosition();
