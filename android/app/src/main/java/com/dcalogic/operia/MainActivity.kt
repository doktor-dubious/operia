package com.dcalogic.operia

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.OperiaTheme
import com.dcalogic.operia.ui.screens.HandoutScreen
import com.dcalogic.operia.ui.screens.HomeScreen
import com.dcalogic.operia.ui.screens.LoginScreen
import com.dcalogic.operia.ui.screens.ConditionScreen
import com.dcalogic.operia.ui.screens.MoveScreen
import com.dcalogic.operia.ui.screens.ParcelGroupScreen
import com.dcalogic.operia.ui.screens.ReceiveScreen
import com.dcalogic.operia.ui.screens.RouteScreen
import com.dcalogic.operia.ui.screens.SearchScreen
import com.dcalogic.operia.ui.screens.StockScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            OperiaTheme {
                OperiaApp()
            }
        }
    }
}

@Composable
fun OperiaApp(vm: AppViewModel = viewModel()) {
    when (vm.sessionState) {
        SessionState.Checking, SessionState.Loading -> Splash()
        SessionState.LoggedOut -> LoginScreen(vm)
        SessionState.Ready -> {
            if (vm.companyId == null) {
                NoCompanyScreen(vm)
            } else {
                AppNav(vm)
            }
        }
    }
}

@Composable
private fun AppNav(vm: AppViewModel) {
    val nav = rememberNavController()
    val back: () -> Unit = { nav.popBackStack() }
    NavHost(navController = nav, startDestination = "home") {
        composable("home") { HomeScreen(vm) { route -> nav.navigate(route) } }
        composable("receive") { ReceiveScreen(vm, back) }
        // handout/move kan åbnes med en pakke forudvalgt (fra Søg) via ?code=…;
        // en almindelig navigate("handout") matcher stadig (code = null).
        composable(
            "handout?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> HandoutScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable(
            "move?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> MoveScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable("condition") { ConditionScreen(vm, back) }
        composable("parcel_group") { ParcelGroupScreen(vm, back) { route -> nav.navigate(route) } }
        composable("search") { SearchScreen(vm, back) { route -> nav.navigate(route) } }
        composable("route") { RouteScreen(vm, back) }
        composable("stock") { StockScreen(vm, back) }
    }
}

@Composable
private fun Splash() {
    Column(
        Modifier.fillMaxSize().background(C.bg),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = C.blue)
    }
}

/** Bruger uden app_users-række (fx DCA platform-admin) — terminalen er
 *  et værktøj for virksomhedens pakkehåndterings-personale. */
@Composable
private fun NoCompanyScreen(vm: AppViewModel) {
    Column(
        Modifier.fillMaxSize().background(C.bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🏢", fontSize = 40.sp)
        Text(
            stringResource(R.string.err_no_company),
            color = C.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
        )
        GhostButton(stringResource(R.string.sign_out)) { vm.logout() }
    }
}
