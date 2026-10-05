import { AuthProvider } from "./auth-provider";
import "./globals.css";

export const metadata = {
  title: "Vitto Loan Repayment",
  description: "MSME loan repayment service",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
