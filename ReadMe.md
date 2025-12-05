# Better Boulder Buses

## Application Description
Better Boulder Buses is a free, Boulder-based public transportation website that allows users to view bus routes, live locations of buses, all Colorado RTD bus schedules, closest bus stops and routes, and user live location services. Our application includes both a user-friendly computer and mobile interface that provides a clean, functional user experience. We also have an interactive map that updates available routes nearby for users based on their location.

---

## Team 7 Contributors
 
Riley Rasizer  
Arman Mokhlesi  
Kian Feiz  
Reed Shisler

---

## Technology Stack
- Frontend: HTML, CSS, JavaScript, Handlebars 
- Backend: Node.js, Express, Shell Scripting
- Database: PostgresQL  
- Version Control: GitHub Repository  

---

## Prerequisites
For Local users: Install Docker, Node, SQL, and npm (to install dependencies).

For Non-local users: No prerequisites.

---

## Instructions to Run the Application Locally

Commands: docker compose down -v (if already ran database)

docker compose up -d

docker compose exec web npm run db:prepare-gtfs (run it once for every fresh database)

---

## How to Run the Tests
Tests will run on start when running application locally.

## Link to the Deployed Application
https://betterboulderbuses.onrender.com/home

