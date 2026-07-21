import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import GraphPage from "./pages/GraphPage";
import { ToastContainer } from "./components/Toast";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/graph/:repoId" element={<GraphPage />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}
