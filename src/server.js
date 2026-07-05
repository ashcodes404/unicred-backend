const app = require("./app");
app.set("trust proxy", 1) ;
const { PORT } = require("./config/env");

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
