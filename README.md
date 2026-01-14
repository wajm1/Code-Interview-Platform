# Code Interview Platform

## Project Overview

The **Code Interview Platform** is a real-time, multi-user web application designed to simulate technical coding interviews. It allows interviewers and candidates to collaboratively write and edit code in a shared environment while communicating through live chat and presence indicators.

The platform focuses on **low-latency collaboration**, **synchronized state**, and **interview realism**, making it suitable for mock interviews, peer practice, or small-scale technical assessments.

Unlike static coding platforms, this project emphasizes **real-time systems design** concepts such as event-driven architecture, WebSockets, concurrency, and shared state management.

## Key Features

*   Real-time collaborative code editor
*   Live chat between participants
*   User presence list (who is currently in the room)
*   Room-based sessions for interviews
*   Username setting and live renaming
*   Synchronized editor state across all clients
*   Low-latency updates using WebSockets

## Technologies Used

*   **Python** – Core backend language
*   **Flask** – Web framework for routing and server logic
*   **Flask-SocketIO** – Real-time bidirectional communication
*   **eventlet** – Asynchronous networking for low-latency sockets
*   **HTML / CSS / JavaScript** – Frontend UI
*   **Socket.IO** – Client-side real-time communication

## System Architecture

The application follows an **event-driven architecture**:

*   Clients connect to the server via WebSockets
*   User actions (typing, joining, chatting, renaming) emit events
*   The server updates shared state and broadcasts changes
*   All connected clients stay synchronized in real time

This mirrors real-world collaborative systems such as Google Docs or shared IDEs, but in a simplified and interview-focused environment.

## Requirements

*   Python 3.9+
*   pip (Python package manager)

## Building and Running

### Installation

Clone the repository and navigate to the project root:

```bash
git clone https://github.com/WajahatMa/Code-Interview-Platform.git
cd Code-Interview-Platform

